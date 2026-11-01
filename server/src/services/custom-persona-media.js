import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const fail = (status, message) => Object.assign(new Error(message), { status });
const MEDIA = /\.(mp3|wav|flac|m4a|ogg|opus|mp4|m4v|mov|webm|weba)$/i;
export function createPersonaMedia({ q1, filesDir, readSources, python = process.env.PERSONA_ASR_PYTHON || fileURLToPath(new URL(process.platform === 'win32' ? '../../../.venv/Scripts/python.exe' : '../../../.venv/bin/python', import.meta.url)) }) {
  const jobs = new Map(), cacheDir = path.join(filesDir, 'persona-transcripts');
  async function file(id) {
    if (!/^[1-9]\d*$/.test(String(id))) throw fail(400, '音视频编号无效');
    const row = q1("SELECT * FROM materials WHERE id=? AND source='agent-upload'", Number(id));
    if (!row || !MEDIA.test(row.name)) throw fail(400, '请选择已上传的音视频');
    const base = await fs.realpath(path.join(filesDir, 'agent-attachments'));
    const local = await fs.realpath(row.local_path);
    if (path.dirname(local) !== base) throw fail(403, '音视频不在上传目录');
    const stat = await fs.stat(local);
    return { row, local, fingerprint: `${stat.size}:${stat.mtimeMs}`, cache: path.join(cacheDir, `${id}.json`) };
  }
  async function cached(info) {
    try { const result = JSON.parse(await fs.readFile(info.cache, 'utf8')); return result.fingerprint === info.fingerprint && typeof result.text === 'string' ? result : null; } catch { return null; }
  }
  async function status(id) {
    const info = await file(id), result = await cached(info);
    if (result) return { ok: true, state: 'ready', chars: result.text.length, notice: result.notice };
    return { ok: true, ...(jobs.get(String(id))?.public || { state: 'idle' }) };
  }
  async function start(id) {
    const info = await file(id), result = await cached(info);
    if (result) return { ok: true, state: 'ready', chars: result.text.length, notice: result.notice };
    if (jobs.get(String(id))?.public.state === 'processing') return status(id);
    await fs.access(python).catch(() => { throw fail(503, '本机转写环境不可用，请提供字幕或文字稿'); });
    await fs.mkdir(cacheDir, { recursive: true });
    const job = { public: { state: 'processing' } }; jobs.set(String(id), job);
    const script = fileURLToPath(new URL('./persona-transcribe.py', import.meta.url));
    const child = spawn(python, [script, info.local], { windowsHide: true, env: { ...process.env, PYTHONUTF8: '1', HF_HUB_OFFLINE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    let output = '', error = '';
    const timer = setTimeout(() => child.kill(), 20 * 60 * 1000); timer.unref();
    child.stdout.on('data', (chunk) => { if (output.length < 4_000_000) output += chunk; });
    child.stderr.on('data', (chunk) => { error = (error + chunk).slice(-1000); });
    child.on('error', () => { clearTimeout(timer); job.public = { state: 'error', error: '本机转写无法启动，请提供字幕或文字稿' }; });
    child.on('close', async (code) => {
      clearTimeout(timer);
      try {
        if (code !== 0) throw new Error(error.includes('No speech') ? '没有识别到讲话，请提供其他材料' : '本机转写未完成，请提供字幕或文字稿');
        const data = JSON.parse(output);
        if (!data.text?.trim()) throw new Error('没有识别到讲话，请提供其他材料');
        const value = { ...data, fingerprint: info.fingerprint };
        await fs.writeFile(info.cache + '.tmp', JSON.stringify(value)); await fs.rename(info.cache + '.tmp', info.cache);
        job.public = { state: 'ready', chars: data.text.length, notice: data.notice };
      } catch (e) { job.public = { state: 'error', error: e.message }; }
    });
    return { ok: true, ...job.public };
  }
  async function read(ids) {
    const sources = await readSources(ids); let budget = 36000;
    for (const item of sources) {
      if (!item.text && /^[1-9]\d*$/.test(String(item.id)) && MEDIA.test(item.name)) {
        const result = await file(item.id).then(cached).catch(() => null);
        if (result) { item.text = result.text; item.status = 'read'; item.notice = result.notice || '本机语音转写，可能有识别误差；说话人归属待核对'; }
        else item.notice = '音视频尚未转写';
      }
      const length = Math.min(12000, budget);
      if (item.text.length > length) { item.text = item.text.slice(0, length); item.status = length ? 'partial' : 'omitted'; item.notice = `${item.notice || ''} · 仅读取前${length}字`; }
      budget -= item.text.length;
    }
    return sources;
  }
  const router = express.Router(), action = (fn) => async (req, res) => { try { res.json(await fn(req.params.id)); } catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : '音视频暂不可用' }); } };
  router.get('/:id', action(status)); router.post('/:id/transcribe', action(start));
  return { router, read, start, status };
}
