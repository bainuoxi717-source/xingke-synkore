// 学习问答（多模态 · 老师视角）：在课堂字幕与 PPT 里检索证据，让 AI 用老师的口吻回答
import { q } from '../db.js';

const STOP = new Set(['什么', '怎么', '为什么', '请问', '一下', '这个', '那个', '可以', '是不是', '有没有', '如何', '我们', '他们', '老师', '意思', '区别', '关系', '以及', '还有', '就是', '那么', '这样', '怎么', '怎样']);

// 中文检索：抽取 2~4 字候选词（去掉停用词），用于命中评分
export function tokenize(text) {
  const t = String(text ?? '').replace(/[^\u4e00-\u9fa5A-Za-z0-9]+/g, ' ').trim();
  const tokens = new Set();
  for (const w of t.split(/\s+/)) {
    if (!w) continue;
    if (/^[A-Za-z0-9]+$/.test(w)) { if (w.length >= 2) tokens.add(w.toLowerCase()); continue; }
    for (let n = 2; n <= 4; n++) {
      for (let i = 0; i + n <= w.length; i++) {
        const g = w.slice(i, i + n);
        if (!STOP.has(g)) tokens.add(g);
      }
    }
  }
  return [...tokens];
}

function scopeSql(scope) {
  const where = [];
  const params = [];
  if (scope?.courIds?.length) { where.push(`cour_id IN (${scope.courIds.map(() => '?').join(',')})`); params.push(...scope.courIds.map(Number)); }
  if (scope?.teacher) { where.push('teacher LIKE ?'); params.push(`%${scope.teacher}%`); }
  if (scope?.courseId) { where.push('course_id = ?'); params.push(Number(scope.courseId)); }
  return { clause: where.length ? ' AND ' + where.join(' AND ') : '', params };
}

// 在字幕里检索最相关的片段（带课次信息与时间戳）
export function retrieveSegments(question, scope = {}, limit = 24) {
  const tokens = tokenize(question);
  const { clause, params } = scopeSql(scope);
  const rows = q(`SELECT cour_id, subj_name, subj_code, teacher, begin_time, leti_number, room,
                         transcript_json, speakers FROM lectures WHERE transcript != ''${clause}`, ...params);

  const scored = [];
  for (const lec of rows) {
    let segs = [];
    try { segs = JSON.parse(lec.transcript_json || '[]'); } catch { /* 忽略 */ }
    // 说话人标签：字幕是全场混录，老师讲课与同学发言都在里面。
    // 学生的分享/提问**同样是课程内容**，不丢弃 —— 只做「降权 + 标明说话人」，
    // 让老师观点排在前面，同时把同学的观点如实标注，避免张冠李戴。
    let labels = [];
    try { labels = JSON.parse(lec.speakers || '[]'); } catch { /* 忽略 */ }
    const hasLabels = labels.length === segs.length;

    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const text = s.text ?? '';
      if (text.length < 4) continue;
      const speaker = hasLabels ? (labels[i] || 'M') : '';
      let score = 0;
      const hits = [];
      for (const tk of tokens) {
        if (text.includes(tk)) { score += tk.length >= 3 ? 3 : 2; hits.push(tk); }
      }
      if (score <= 0) continue;
      // 排序权重：老师观点为主线，但同学的提问/回答/分享**同样是课程内容**，只做轻微降权
      scored.push({ ...lec, speakers: undefined, start: s.start, end: s.end, text, score, hits, speaker });
    }
  }
  const rank = (x) => (x.speaker === 'T' ? x.score * 1.25 : x.speaker === 'S' ? x.score * 0.85 : x.score);
  const byRank = (a, b) => rank(b) - rank(a);

  // 配额挑选：先按主线（老师）取大部分，再**保留一部分名额给同学发言**，
  // 确保课堂讨论不会被老师的长篇讲述完全淹没。
  const teacherPool = scored.filter((x) => x.speaker === 'T').sort(byRank);
  const studentPool = scored.filter((x) => x.speaker === 'S').sort(byRank);
  const otherPool = scored.filter((x) => x.speaker !== 'T' && x.speaker !== 'S').sort(byRank);

  const studentQuota = studentPool.length ? Math.max(2, Math.round(limit * 0.25)) : 0;
  const picked = [];
  const perLecture = new Map();
  const push = (x) => {
    const n = perLecture.get(x.cour_id) ?? 0;
    if (n >= 6) return false;                       // 同一节课最多 6 段，避免单节刷屏
    perLecture.set(x.cour_id, n + 1);
    picked.push(x);
    return true;
  };
  // ① 同学发言配额
  for (const x of studentPool) { if (picked.length >= studentQuota) break; push(x); }
  // ② 老师主线填满剩余
  for (const x of teacherPool) { if (picked.length >= limit - Math.min(2, otherPool.length)) break; push(x); }
  // ③ 未识别的补位
  for (const x of otherPool) { if (picked.length >= limit) break; push(x); }

  // 输出顺序：老师主线在前，但把同学发言穿插进来 ——
  // 避免同学内容全排在末尾，导致提示词/界面上实际看不到课堂讨论。
  const pickedT = picked.filter((x) => x.speaker === 'T').sort(byRank);
  const pickedS = picked.filter((x) => x.speaker === 'S').sort(byRank);
  const pickedO = picked.filter((x) => x.speaker !== 'T' && x.speaker !== 'S').sort(byRank);
  const mixed = [];
  let ti = 0, si = 0, oi = 0;
  while (mixed.length < picked.length) {
    for (let k = 0; k < 3 && ti < pickedT.length; k++) mixed.push(pickedT[ti++]);
    if (si < pickedS.length) mixed.push(pickedS[si++]);
    if (oi < pickedO.length) mixed.push(pickedO[oi++]);
    if (ti >= pickedT.length && si >= pickedS.length && oi >= pickedO.length) break;
  }
  return mixed.slice(0, limit);
}

// 在 PPT 的 OCR 文本里检索相关切片（返回图片 URL，可当证据展示）
export function retrieveSlides(question, scope = {}, limit = 6) {
  const tokens = tokenize(question);
  const { clause, params } = scopeSql(scope);
  const rows = q(`SELECT cour_id, subj_name, teacher, begin_time, leti_number, ppt_json FROM lectures WHERE ppt_json != ''${clause}`, ...params);
  const scored = [];
  for (const lec of rows) {
    let slides = [];
    try { slides = JSON.parse(lec.ppt_json || '[]'); } catch { /* 忽略 */ }
    for (const sl of slides) {
      const ocr = sl.ocr ?? '';
      if (ocr.length < 2) continue;
      let score = 0;
      for (const tk of tokens) if (ocr.includes(tk)) score += tk.length >= 3 ? 4 : 3;
      if (score > 0) scored.push({ ...lec, url: sl.url, seek: sl.seek, ocr, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const seen = new Set();
  const out = [];
  for (const s of scored) {
    if (seen.has(s.url)) continue;
    seen.add(s.url);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

export const mmss = (ms) => {
  const total = Math.round(Number(ms ?? 0) / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

// 宽容 JSON 解析：模型常在字符串里输出裸换行/代码块，导致 JSON.parse 失败
export function parseLooseJson(raw) {
  let t = String(raw ?? '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let body = t.slice(start, end + 1);

  const attempts = [
    body,
    // 把字符串内部的裸换行/制表符转义
    body.replace(/"(?:[^"\\]|\\.)*"/g, (m) => m.replace(/\n/g, '\\n').replace(/\r/g, '').replace(/\t/g, '\\t')),
    // 去掉尾随逗号
    body.replace(/,\s*([}\]])/g, '$1'),
  ];
  // 组合：先转义裸换行，再去尾逗号
  attempts.push(attempts[1].replace(/,\s*([}\]])/g, '$1'));

  for (const a of attempts) {
    try { return JSON.parse(a); } catch { /* 继续尝试 */ }
  }
  // 最后兜底：只把 answer 抠出来
  const m = body.match(/"answer"\s*:\s*"([\s\S]*?)"\s*,\s*"(?:citations|slides|chart|followups|coverage)"/);
  if (m) {
    const ans = m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    return { answer: ans, citations: [], slides: [], chart: null, followups: [], coverage: 'partial' };
  }
  return null;
}

// 老师视角的 system prompt
export function buildSystemPrompt({ teacher, subjName, mode = 'teacher', teachingStyle = '' }) {
  const persona = teachingStyle || `你是学习助手，根据课堂原文与学生选择的资料讲解。${mode === 'teacher' ? '可沿用原老师的教学顺序，但不冒充老师本人。' : ''}`;

  return `你是上海交通大学课堂内容问答系统。${persona}
${teacher ? `\n课程材料的原老师：**${teacher}**${subjName ? `（课程：${subjName}）` : ''}。原老师与所选讲解人物是不同概念。` : ''}

**说话人区分（非常重要）**：
课堂记录是全场混录的，既有**老师讲课**，也有**同学的提问、回答和分享**。两者都是课程内容，但**绝不能混淆**：
- 每条材料前有说话人标记。未识别、无法判断或没有标注时保持未知，不推断为老师。
- **【同学】说的内容不是原老师说过的话**，不得以第一人称当成老师或所选人物的观点复述。
- 同学的观点很有价值时可以引用，但必须写成"课上也有同学提到……""有同学问过……"这样**明确归给同学**。
- 所选人物只决定思考和讲解方式；事实、观点归属与引用由原始资料决定，不虚构人物经历或原话。

**回答规则**：
1. **必须以课堂原始记录为依据**，优先采用【老师】的内容。
2. 引用时必须标注出处与说话人，格式 _【日期 第N节 mm:ss · 老师/同学】_，并在 citations 里给出结构化引用（含 speaker 字段）。
3. 课堂没讲到的、但作为该学科专家有必要补充的，必须**显式标注【课外补充】**。
4. 课堂记录里确实没有相关内容时，说明资料不足；不得宣称自己教过这节课。用户选择的资料用[资料N]就地引用；课程笔记是二次整理，不得把笔记改写当作老师逐字原话。对未读取的文件不可声称已理解其内容。
5. **必须在正文里就地引用 PPT**：只要下方给了 PPT 切片，就至少引用一次，**原样写成「PPT 第 N 张」**（N 是 P 后面的编号），
   例如"我们看 **PPT 第 2 张**，这里……"。系统会在这个位置**自动嵌入那张真实 PPT 的图片**，学生边读边看到图。
   slides 数组里为每张被引用的 PPT 写一句 comment（这张图说明了什么）。
7. 涉及对比、数量、趋势时，主动给 chart 数据（前端会渲染成真图表），不要只用文字表格。

**严格只输出 JSON**（不要用 markdown 代码块包裹）：
{
  "answer": "回答正文（可用 markdown：粗体、列表、公式）",
  "citations": [{"n":1,"date":"2026-09-29","leti":8,"time":"12:30","speaker":"老师","quote":"原话片段"}],
  "slides": [{"idx":"P1","comment":"这张 PPT 说明了什么"}],
  "chart": {"type":"bar","title":"标题","labels":["A","B"],"values":[1,2]},
  "followups": ["可以继续追问的问题"],
  "coverage": "full|partial|none"
}
chart 不需要时给 null。`;
}

// 组装完整 user 内容
export function buildUserContent(question, { segments, slides }) {
  const evidence = segments.map((s, i) => {
    const who = s.speaker === 'T' ? '老师' : s.speaker === 'S' ? '同学' : '未识别';
    return `[${i + 1}] 【${s.subj_name}｜${String(s.begin_time).slice(0, 10)} 第${s.leti_number}节｜${mmss(s.start)}｜${who}】${s.text}`;
  }).join('\n') || '（没有检索到相关课堂原话）';
  const slideText = slides.map((s, i) =>
    `[P${i + 1}] 【${s.subj_name}｜${String(s.begin_time).slice(0, 10)}】OCR: ${s.ocr.slice(0, 400)}`
  ).join('\n') || '（没有检索到相关 PPT）';

  return `## 学生的问题
${question}

## 课堂记录（按相关度排序；【老师】讲课 / 【同学】提问、回答与分享 —— 都是课程内容，请按说话人如实归因）
${evidence}

## 相关 PPT 切片（OCR 文本；图片会随回答一起展示给学生）
${slideText}`;
}
