// 老师圆桌：多位老师同时参与同一问题
//   ① 并答：每位老师用自己的口吻独立回答（并行）
//   ② 对话：第二轮每位老师看到别人的观点后回应（认同/商榷/补充）
//   ③ 融合：把多学科视角合成一份完整讲解，标明共识与分歧
import { askDeepSeekStream } from './ai.js';
import { retrieveSegments, retrieveSlides, buildSystemPrompt, buildUserContent, mmss } from './qa.js';

// 圆桌的 system prompt（在单师 prompt 基础上追加协作规则）
export function buildRoundtablePrompt({ teacher, subjName, peers = [], phase = 'answer', transcripts = [] }) {
  const base = buildSystemPrompt({ teacher, subjName, mode: 'teacher' })
    .replace(/\*\*严格只输出 JSON\*\*[\s\S]*$/, '');

  const other = peers.filter((p) => p !== teacher);

  if (phase === 'respond' && other.length) {
    return base + `

**本轮是「圆桌对话」第二轮**：除了你本人的课堂记录，下面还会给出**其他老师**对同一问题的回答。
请你以本人的身份**回应他们**：
- 认同的地方明确说"XX 老师说的这点我同意"，并说明为什么（最好能关联你课上讲过的内容）
- 不同意或角度看不同的地方，直接提出你的看法（学术讨论要坦率，但保持尊重）
- 用你自己的学科视角补充对方没提到的部分
- **不要重复你第一轮的完整回答**，只讲"补充/商榷/延伸"的部分，控制在 500 字以内
- 其他老师的话要明确归给他们，不要当成你自己说的

**输出要求**：直接输出 markdown 正文，不要 JSON、不要包代码块。`;
  }

  return base + `

**输出要求**：
- 直接输出 markdown 正文，**不要输出 JSON、不要包代码块**。
- 引用课堂原话时写成 _【日期 第N节 mm:ss · 老师/同学】_ 的形式。
- **控制在 700 字以内**，讲清你这一门课的核心视角即可（因为还有别的老师要发言）。
- 如果你是这门课的教学团队之一，用「我们这门课」的口吻，不要假装是某一个人的私人观点。`;
}

// 融合总结的 prompt（教学主持人视角）
export function buildSynthesisPrompt({ question, answers }) {
  const list = answers.map((a) => `### ${a.teacher}（${a.subjName || '未知课程'}）\n${a.text}`).join('\n\n');
  return `你是跨学科教学的主持人。下面有 ${answers.length} 位来自不同课程的老师，回答同一个学生问题。

${list}

**你的任务**：把他们的观点**融合成一份完整、有条理的讲解**，让学生一次看懂：
1. **开篇一句话**给出综合结论
2. **共识**：几位老师都认同的核心是什么
3. **各自视角**：每位老师从自己学科出发补充了什么（**明确标注是哪位老师、哪门课**）
4. **分歧或张力**：他们的观点在哪里不同 / 互补 / 有张力（如果确实存在；不要硬凑）
5. **合起来怎么用**：学生面对这个问题时，综合起来应该怎么理解和行动

**要求**：
- 用 markdown（小标题、粗体、列表）
- **必须标明观点归属**（"XX 老师指出…"），不能笼统地说"老师们认为"
- 保留老师们各自的关键原话或例子（可以简短引用）
- 控制在 1200 字以内，不要客套，直接给干货

**直接输出 markdown 正文**，不要 JSON、不要代码块包裹。`;
}

// 取每位老师的检索材料
export function gatherForTeacher(question, teacher) {
  const segments = retrieveSegments(question, { teacher }, 16);
  const slides = retrieveSlides(question, { teacher }, 4);
  return { segments, slides };
}

export function evidenceOf(segments) {
  return segments.slice(0, 10).map((x) => ({
    courId: x.cour_id, date: String(x.begin_time).slice(0, 10), leti: x.leti_number,
    time: mmss(x.start), subj: x.subj_name, text: x.text,
    speaker: x.speaker === 'S' ? '同学' : x.speaker === 'M' ? '未识别' : '老师',
  }));
}

export function citationsOf(segments) {
  return segments.slice(0, 4).map((x, i) => ({
    n: i + 1, date: String(x.begin_time).slice(0, 10), leti: x.leti_number,
    time: mmss(x.start), quote: String(x.text).slice(0, 90),
    speaker: x.speaker === 'S' ? '同学' : x.speaker === 'M' ? '未识别' : '老师',
  }));
}

export function slidesOf(slides) {
  return slides.map((x, i) => ({
    idx: `P${i + 1}`, url: x.url, ocr: x.ocr, subj: x.subj_name,
    date: String(x.begin_time).slice(0, 10), leti: x.leti_number, seek: x.seek, comment: '',
  }));
}

// 跑一位老师的某一轮
export async function runTeacher({ apiKey, model, question, teacher, subjName, phase, peers, transcripts, onDelta }) {
  const { segments, slides } = gatherForTeacher(question, teacher);
  let system = buildRoundtablePrompt({ teacher, subjName, peers, phase });
  let user = buildUserContent(question, { segments, slides });

  if (phase === 'respond' && transcripts?.length) {
    const others = transcripts
      .filter((t) => t.teacher !== teacher && t.text)
      .map((t) => `【${t.teacher} 老师（${t.subjName || '其他课程'}）】\n${t.text}`)
      .join('\n\n');
    user = `${user}\n\n## 其他老师的回答（请针对他们的观点作出回应）\n${others || '（暂时没有其他老师的回答）'}`;
  }

  const text = await askDeepSeekStream(apiKey, system, user,
    { thinking: 'off', maxTokens: phase === 'respond' ? 1200 : 1600, temperature: 0.6, model },
    onDelta);
  return { text, segments, slides };
}
