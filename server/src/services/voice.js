// 老师音色克隆：把课堂录播里的老师声音提取出来，克隆成可复用的音色，
// 之后问答的「朗读」就用老师本人的声音。
//
// 链路：
//   ① 采样：课堂 mp4 → ffmpeg 截取「纯老师连续讲话」的一段 → 16k 单声道 wav
//   ② 克隆：上传样本到声音克隆服务 → 得到 voice_id（每个老师一次）
//   ③ 合成：文本 + voice_id → 音频（缓存，同样的文本不重复花钱）
//
// 设计要点：
//   - 服务商可插拔（默认 MiniMax，中文质量好、支持直接上传本地文件、便宜）
//   - 样本只截老师说话段（用 speakers 标注 + 字幕时间轴）
//   - 合成结果按 文本hash+voiceId 缓存到磁盘，重复朗读零成本
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { q, q1, run, nowISO, getSettings, DATA_DIR } from '../db.js';

const VOICE_DIR = path.join(DATA_DIR, 'voices');       // 样本与合成缓存
const SAMPLE_DIR = path.join(VOICE_DIR, 'samples');
const TTS_DIR = path.join(VOICE_DIR, 'tts');

export function ensureVoiceDirs() {
  for (const d of [VOICE_DIR, SAMPLE_DIR, TTS_DIR]) fs.mkdirSync(d, { recursive: true });
}

export function ensureVoiceTable() {
  ensureVoiceDirs();
  run(`CREATE TABLE IF NOT EXISTS teacher_voices (
    teacher TEXT PRIMARY KEY,
    provider TEXT DEFAULT '',
    voice_id TEXT DEFAULT '',
    sample_path TEXT DEFAULT '',
    sample_seconds REAL DEFAULT 0,
    source_cour_id INTEGER,
    source_range TEXT DEFAULT '',
    status TEXT DEFAULT '',        -- '' | sampling | ready | error
    error TEXT DEFAULT '',
    created_at TEXT DEFAULT '',
    updated_at TEXT DEFAULT ''
  )`);
}

// ---------- ffmpeg 定位 ----------
let ffmpegPath = null;
export function findFfmpeg() {
  if (ffmpegPath && fs.existsSync(ffmpegPath)) return ffmpegPath;
  const cands = [
    'ffmpeg',
    path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'),
  ];
  // WinGet 安装的 ffmpeg 在 Packages 下，扫一下
  try {
    const base = path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Packages');
    for (const d of fs.readdirSync(base)) {
      if (/ffmpeg/i.test(d)) {
        const bin = path.join(base, d);
        for (const sub of fs.readdirSync(bin)) {
          const p = path.join(bin, sub, 'bin', 'ffmpeg.exe');
          if (fs.existsSync(p)) cands.unshift(p);
        }
      }
    }
  } catch { /* 忽略 */ }
  for (const c of cands) { if (c === 'ffmpeg' || fs.existsSync(c)) { ffmpegPath = c; return c; } }
  return null;
}

function runFfmpeg(args, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const exe = findFfmpeg();
    if (!exe) return reject(new Error('找不到 ffmpeg，请先安装（winget install Gyan.FFmpeg）'));
    const p = spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d.toString(); if (err.length > 6000) err = err.slice(-3000); });
    const timer = setTimeout(() => { try { p.kill(); } catch { } reject(new Error('ffmpeg 超时')); }, timeoutMs);
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(true);
      else reject(new Error('ffmpeg 退出码 ' + code + '：' + err.slice(-300)));
    });
  });
}

// ---------- ① 采样：从课堂录播截一段纯老师讲话 ----------
// 用字幕时间轴 + speakers 标注，找一段连续 ≥40 秒都是「老师」的区间
export function pickTeacherSpan(courId, minSec = 40, maxSec = 90) {
  const row = q1('SELECT transcript_json, speakers FROM lectures WHERE cour_id = ?', courId);
  if (!row) return null;
  let segs = [], labels = [];
  try { segs = JSON.parse(row.transcript_json || '[]'); } catch { return null; }
  try { labels = JSON.parse(row.speakers || '[]'); } catch { /* 忽略 */ }

  // 优先：连续老师片段
  let best = null, curStart = null, curLen = 0;
  for (let i = 0; i < segs.length; i++) {
    const isTeacher = labels[i] ? labels[i] === 'T' : true;   // 没标注就都当老师
    const dur = Math.max(0, (Number(segs[i].end ?? 0) - Number(segs[i].start ?? 0)) / 1000);
    if (isTeacher) {
      if (curStart === null) curStart = Number(segs[i].start ?? 0) / 1000;
      curLen += dur;
      if (curLen >= minSec) {
        const span = { start: curStart, duration: Math.min(curLen, maxSec), text: '连续老师发言' };
        if (!best || span.duration > best.duration) best = span;
        if (best.duration >= maxSec) break;
        curStart = null; curLen = 0;
      }
    } else { curStart = null; curLen = 0; }
  }
  if (best) return best;
  // 退路：直接取第一段 60 秒
  if (segs.length) return { start: Number(segs[0].start ?? 0) / 1000, duration: 60, text: '（无标注，取开头 60 秒）' };
  return null;
}

// 从远程 mp4（或本地文件）截取音频为 16k 单声道 wav
export async function extractSample({ source, start, duration, teacher }) {
  ensureVoiceDirs();
  const safe = String(teacher).replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || 'teacher';
  const out = path.join(SAMPLE_DIR, safe + '.wav');
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', String(Math.max(0, Math.floor(start))),
    '-t', String(Math.max(20, Math.floor(duration))),
    '-i', source,
    '-vn', '-ac', '1', '-ar', '32000', '-acodec', 'pcm_s16le',
    out,
  ];
  await runFfmpeg(args, 180000);
  const st = fs.statSync(out);
  if (st.size < 20 * 1024) throw new Error('截出来的音频太小（' + Math.round(st.size / 1024) + 'KB），可能该时段是静音');
  return { file: out, bytes: st.size, seconds: Math.max(20, Math.floor(duration)) };
}

// 把任意格式的音频（mp3/wav/m4a/视频）规范化成 32k 单声道 wav，并截断到 120 秒以内
// 用途：用户直接上传一小段老师讲话时，不依赖课堂录播
export async function normalizeAudio(inputFile, teacher) {
  ensureVoiceDirs();
  const safe = String(teacher).replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || 'teacher';
  const out = path.join(SAMPLE_DIR, safe + '.wav');
  await runFfmpeg([
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', inputFile,
    '-t', '120',                       // 最多取 120 秒，够克隆了
    '-vn', '-ac', '1', '-ar', '32000', '-acodec', 'pcm_s16le',
    out,
  ], 180000);
  const st = fs.statSync(out);
  if (st.size < 200 * 1024) throw new Error('音频太短（' + Math.round(st.size / 1024) + 'KB），请提供 20 秒以上');
  const seconds = Math.min(120, Math.round(st.size / 64000));
  return { file: out, bytes: st.size, seconds };
}

// ---------- ② 克隆：MiniMax 声音复刻 ----------
// 需要 settings.minimaxKey（以及可选的 minimaxGroupId）
async function minimaxUpload(file, apiKey) {
  const buf = fs.readFileSync(file);
  const form = new FormData();
  form.append('purpose', 'voice_clone');
  form.append('file', new Blob([buf], { type: 'audio/wav' }), path.basename(file));
  const r = await fetch('https://api.minimax.chat/v1/files/upload', {
    method: 'POST', headers: { Authorization: 'Bearer ' + apiKey }, body: form,
    signal: AbortSignal.timeout(120000),
  });
  const j = await r.json().catch(() => ({}));
  const fileId = j?.file?.file_id ?? j?.file_id;
  if (!fileId) throw new Error('上传失败：' + JSON.stringify(j).slice(0, 200));
  return fileId;
}

async function minimaxClone(fileId, voiceId, apiKey, title) {
  const r = await fetch('https://api.minimax.chat/v1/voice_clone', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: fileId, voice_id: voiceId, text: '', model: 'speech-02-hd' }),
    signal: AbortSignal.timeout(120000),
  });
  const j = await r.json().catch(() => ({}));
  const code = j?.base_resp?.status_code;
  if (code !== 0 && code !== undefined && code !== null) {
    throw new Error('克隆失败(' + code + ')：' + (j?.base_resp?.status_msg ?? JSON.stringify(j).slice(0, 160)));
  }
  return { voiceId };
}

// 统一克隆入口（后续要接其他服务商，在这里加分支即可）
export async function cloneToProvider({ teacher, file }) {
  const s = getSettings();
  const provider = s.voiceProvider || 'minimax';
  if (provider === 'minimax') {
    const key = s.minimaxKey ?? '';
    if (!key) throw new Error('没配置 MiniMax API Key（到「导入与设置」填写 minimaxKey）');
    const voiceId = 'teacher_' + createHash('md5').update(String(teacher)).digest('hex').slice(0, 12);
    const fileId = await minimaxUpload(file, key);
    await minimaxClone(fileId, voiceId, key, teacher);
    return { provider, voiceId };
  }
  throw new Error('暂不支持的音色服务商：' + provider);
}

// ---------- ③ 合成：文本 → 音频（磁盘缓存） ----------
export async function synthesize({ teacher, text }) {
  const s = getSettings();
  if (!s.voiceEnabled) throw new Error('音色功能未开启');
  const v = q1("SELECT * FROM teacher_voices WHERE teacher = ? AND voice_id != ''", teacher);
  if (!v) throw new Error('这位老师还没有克隆音色');

  const clean = String(text ?? '').replace(/[#*`>|_~\[\]()]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1200);
  if (!clean) throw new Error('没有可朗读的文本');

  ensureVoiceDirs();
  const hash = createHash('md5').update(v.voice_id + '|' + clean).digest('hex');
  const cached = path.join(TTS_DIR, hash + '.mp3');
  if (fs.existsSync(cached)) return { file: cached, cached: true };

  const provider = v.provider || 'minimax';
  if (provider === 'minimax') {
    const key = s.minimaxKey ?? '';
    if (!key) throw new Error('没配置 MiniMax API Key');
    const r = await fetch('https://api.minimax.chat/v1/t2a_v2', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'speech-02-hd',
        text: clean,
        stream: false,
        voice_setting: { voice_id: v.voice_id, speed: 1.0, vol: 1.0, pitch: 0 },
        audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3' },
      }),
      signal: AbortSignal.timeout(180000),
    });
    const j = await r.json().catch(() => ({}));
    const hex = j?.data?.audio;
    if (!hex) {
      const msg = j?.base_resp?.status_msg ?? JSON.stringify(j).slice(0, 200);
      throw new Error('合成失败：' + msg);
    }
    const buf = Buffer.from(hex, 'hex');
    if (buf.length < 2000) throw new Error('合成音频过小');
    fs.writeFileSync(cached, buf);
    trimTtsCache();
    return { file: cached, cached: false };
  }
  throw new Error('暂不支持的音色服务商：' + provider);
}

function trimTtsCache(maxMb = 300) {
  try {
    const files = fs.readdirSync(TTS_DIR).map((n) => {
      const p = path.join(TTS_DIR, n); const st = fs.statSync(p);
      return { p, size: st.size, mtime: st.mtimeMs };
    });
    const total = files.reduce((s, f) => s + f.size, 0);
    if (total <= maxMb * 1024 * 1024) return;
    files.sort((a, b) => a.mtime - b.mtime);
    let freed = 0;
    for (const f of files) {
      if (total - freed <= maxMb * 1024 * 1024 * 0.6) break;
      try { fs.unlinkSync(f.p); freed += f.size; } catch { /* 忽略 */ }
    }
  } catch { /* 忽略 */ }
}

// ---------- 状态总览 ----------
export function voiceStatus() {
  ensureVoiceTable();
  const teachers = q(`SELECT teacher, COUNT(*) AS lectures, SUM(LENGTH(transcript)) AS chars
                      FROM lectures WHERE teacher != '' GROUP BY teacher ORDER BY lectures DESC`);
  // 给每位老师挑一个「字幕够长」的课次，供自动采样用
  const sampleCour = {};
  for (const t of teachers) {
    const r = q1(`SELECT cour_id FROM lectures WHERE teacher = ? AND LENGTH(transcript) > 8000
                  ORDER BY begin_time DESC LIMIT 1`, t.teacher);
    if (r) sampleCour[t.teacher] = r.cour_id;
  }
  const voices = q('SELECT * FROM teacher_voices');
  const map = Object.fromEntries(voices.map((v) => [v.teacher, v]));
  const s = getSettings();
  return {
    enabled: !!s.voiceEnabled,
    provider: s.voiceProvider || 'minimax',
    hasKey: !!(s.minimaxKey ?? ''),
    ffmpeg: !!findFfmpeg(),
    teachers: teachers.map((t) => {
      const v = map[t.teacher];
      return {
        teacher: t.teacher, lectures: t.lectures, sampleCourId: sampleCour[t.teacher] ?? null,
        hasVoice: !!(v && v.voice_id),
        status: v?.status ?? '',
        sampleSeconds: v?.sample_seconds ?? 0,
        error: v?.error ?? '',
        updatedAt: v?.updated_at ?? '',
      };
    }),
    ready: voices.filter((v) => v.voice_id).length,
  };
}
