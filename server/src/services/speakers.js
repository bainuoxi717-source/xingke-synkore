// 说话人区分：课堂字幕是全场混录，学生发言也在里面。
// 若不区分，AI 会把「学生的话」当成「老师的原话」引用 —— 这是致命的准确性问题。
//
// 做法：按课次把字幕分段交给 AI 标注说话人（T=老师 / S=学生 / M=多人或无法判断），
//      结果缓存到 lectures.speakers，检索时优先取老师片段。
import { q, q1, run, nowISO } from '../db.js';
import { askDeepSeek } from './ai.js';

const PROMPT = `你是课堂录播转写的说话人标注助手。下面是**同一节课**按时间顺序排列的转写片段（自动语音识别，可能有错字）。

请判断**每一段是谁在说话**：
- **T（老师）**：讲课、解释概念、布置任务、总结、念材料/案例、引导性提问（"你们去看"、"我们来看"、"这个很关键"、"大家注意"）
- **S（学生）**：回答老师的提问、主动提问、简短应和（"嗯"、"对"）、分享个人观点与经历（"我觉得"、"我选"、"老师我想问"、"我们组"）
- **M（无法判断/多人）**：听不清、多人同时说话、纯语气词

判断线索：
1. 学生在**老师提问之后**发言；老师常在提问后说"谁来说说""有同学吗"
2. 学生常用第一人称谈**自己的**经历/选择（"我选这篇的原因是"、"我们小组"）
3. 老师会用教学语言（"这一章""考试""作业""上次我们讲"）与集体称呼（"你们""大家""我们班"）
4. 老师可能连续讲很久；学生发言通常较短（但也有例外）

**严格只输出 JSON**：{"1":"T","2":"S","3":"T",...}，键是片段编号，值是 T/S/M。
不要输出任何其他文字。`;

export function ensureSpeakersColumn() {
  const cols = q(`PRAGMA table_info(lectures)`).map((c) => c.name);
  if (!cols.includes('speakers')) run(`ALTER TABLE lectures ADD COLUMN speakers TEXT DEFAULT ''`);
  if (!cols.includes('speaker_tagged_at')) run(`ALTER TABLE lectures ADD COLUMN speaker_tagged_at TEXT DEFAULT ''`);
}

// 对一课次做说话人标注
export async function classifyLecture(courId, apiKey, model, { batch = 60 } = {}) {
  const lec = q1('SELECT cour_id, subj_name, transcript_json FROM lectures WHERE cour_id = ?', courId);
  if (!lec) throw new Error('课次不存在');
  const segs = JSON.parse(lec.transcript_json || '[]');
  if (!segs.length) return { ok: false, error: '没有字幕' };

  const labels = new Array(segs.length).fill('M');
  for (let start = 0; start < segs.length; start += batch) {
    const chunk = segs.slice(start, start + batch);
    const numbered = chunk.map((s, i) => `${i + 1}. ${String(s.text).slice(0, 120)}`).join('\n');
    const raw = await askDeepSeek(
      apiKey,
      PROMPT,
      `本节课：${lec.subj_name}\n共 ${chunk.length} 段（编号从 1 开始）\n\n${numbered}`,
      { thinking: 'off', maxTokens: 2000, temperature: 0.1, model }
    );
    let parsed = null;
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch { /* 忽略 */ } }
    if (parsed) {
      for (const [k, v] of Object.entries(parsed)) {
        const idx = Number(k) - 1;
        if (idx >= 0 && idx < chunk.length && ['T', 'S', 'M'].includes(v)) labels[start + idx] = v;
      }
    }
  }

  run('UPDATE lectures SET speakers = ?, speaker_tagged_at = ? WHERE cour_id = ?',
    JSON.stringify(labels), nowISO(), courId);
  const counts = labels.reduce((a, b) => (a[b] = (a[b] ?? 0) + 1, a), {});
  return { ok: true, total: labels.length, counts };
}

// 取一课次的说话人标签
export function speakersOf(courId) {
  const row = q1('SELECT speakers FROM lectures WHERE cour_id = ?', courId);
  try { return JSON.parse(row?.speakers || '[]'); } catch { return []; }
}

// 统计：还有多少课次没标注
export function taggingStatus() {
  const all = q(`SELECT COUNT(*) AS n FROM lectures`)[0].n;
  const done = q(`SELECT COUNT(*) AS n FROM lectures WHERE speaker_tagged_at != ''`)[0].n;
  const segs = q(`SELECT SUM(json_array_length(CASE WHEN json_valid(transcript_json) THEN transcript_json ELSE '[]' END)) AS n FROM lectures`)[0].n;
  return { lectures: all, tagged: done, segments: segs };
}
