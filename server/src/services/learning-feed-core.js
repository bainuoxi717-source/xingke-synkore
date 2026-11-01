import { createHash } from 'node:crypto';

export const FEED_RECIPE = 'voicebox-learning-v4';
export const hashContent = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const parseJSON = (value, fallback = null) => { try { return JSON.parse(value); } catch { return fallback; } };
export const plainText = (value = '') => String(value).replace(/```[\s\S]*?```/g, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[#*_`>|]/g, '').replace(/\s+/g, ' ').trim();
export function isLearningAnswer(question, body, meta = {}) {
  const text = plainText(body);
  if (text.length < 30 || meta.coverage === 'none') return false;
  if (/(?:没配置|未配置).{0,20}(?:Key|模型)|^⚠️|AI 调用失败|没有找到相关课堂材料/.test(text)) return false;
  if (/口头禅|昨天.{0,6}行程|作业.{0,8}(?:交到哪|发到哪|哪个邮箱|提交截止)|你的.{0,6}邮箱|老师.{0,6}联系方式/.test(question)) return false;
  if (text.length < 180 && /没有专门讲过|没专门讲过|没有展开讲|没展开讲|没法.{0,15}(?:编|回答)|无法.{0,15}(?:回答|确认)|没有.{0,8}(?:提及|提到|涉及)/.test(text)) return false;
  return true;
}
export function sourceTopic(source) {
  const text = plainText(source.question || source.knowledgePoint || source.title || source.body)
    .replace(/^(?:请问|能不能|能否|帮我|请|老师[，,：:]?)+/g, '').replace(/^(?:用.{1,12}的(?:语气|方式|风格))/, '')
    .replace(/^(?:解释一下|讲讲|梳理一下|解释|介绍一下)/, '').replace(/[？?。！!]+$/g, '').trim();
  return text.slice(0, 26) || '这节课的关键知识';
}
export function feedCategory(text) {
  if (/极限|微积分|导数|矩阵|函数|概率|积分|ε|delta|方差/i.test(text)) return '把原理讲透';
  if (/传播|沟通|新闻|媒介|社会|叙事|文化|议程|自我披露/.test(text)) return '换个角度看';
  if (/代码|编程|模型|算法|计算机|神经|agent|python|AI\b/i.test(text)) return '从零搭起来';
  if (/英语|单词|语法|词汇|翻译|英文|language/i.test(text)) return '越学越顺';
  return '值得再看一遍';
}
export function markedContext(segments, timeMs, before = 45000, after = 45000) {
  return segments.filter((segment) => Number(segment.endMs) >= timeMs - before && Number(segment.startMs) <= timeMs + after && String(segment.text || '').trim())
    .slice(0, 40).map((segment) => ({ ...segment, text: String(segment.text).trim() }));
}
export function mergeMarkerWindows(markers, durationMs, radius = 45000) {
  const windows = markers.map((marker) => ({ startMs: Math.max(0, marker.audioMs - radius), endMs: Math.min(durationMs, marker.audioMs + radius) }))
    .filter((window) => Number.isFinite(window.startMs) && window.endMs > window.startMs).sort((a, b) => a.startMs - b.startMs);
  const merged = [];
  for (const window of windows) {
    const previous = merged.at(-1);
    if (previous && previous.endMs >= window.startMs) previous.endMs = Math.max(previous.endMs, window.endMs);
    else merged.push({ ...window });
  }
  return merged;
}
export function retrieveSourceChunks(chunks, query, limit = 3) {
  const terms = (text) => {
    const normalized = plainText(text).toLowerCase().replace(/\s+/g, '');
    return new Set([...(normalized.match(/[a-z0-9_]{2,}/g) || []), ...Array.from({ length: Math.max(0, normalized.length - 1) }, (_, index) => normalized.slice(index, index + 2))]);
  };
  const selected = terms(query);
  return chunks.map((chunk) => { const tokens = terms(chunk.text); return { ...chunk, score: [...selected].filter((term) => tokens.has(term)).length / Math.sqrt(Math.max(1, tokens.size)) }; })
    .filter((chunk) => chunk.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}
export function chunkDocument(pages, size = 700, overlap = 100) {
  const chunks = [];
  for (const page of pages) {
    const text = String(page.text || '').replace(/[ \t]+/g, ' ').trim();
    for (let offset = 0; offset < text.length;) {
      let end = Math.min(text.length, offset + size);
      const boundary = Math.max(text.lastIndexOf('。', end), text.lastIndexOf('\n', end));
      if (end < text.length && boundary > offset + size / 2) end = boundary + 1;
      if (text.slice(offset, end).trim()) chunks.push({ page: page.page, text: text.slice(offset, end).trim(), name: page.name });
      if (end === text.length) break;
      offset = Math.max(offset + 1, end - overlap);
    }
  }
  return chunks;
}
export function feedPriority(post, feedback, now = Date.now()) {
  const base = { unclear: 100, important: 92, qa: 84, demo: 65 }[post.origin] || 70;
  const weights = { confused: 4, mastered: -6 };
  const created = Date.parse(post.createdAt);
  const days = Number.isFinite(created) ? Math.max(0, (now - created) / 86400000) : Infinity;
  return base + (weights[feedback] || 0) + Math.max(0, 3 - days / 7);
}
function topicTitle(topic, origin, salt) {
  const fit = (prefix, text, suffix) => `${prefix}${text.slice(0, 32 - prefix.length - suffix.length)}${suffix}`;
  if (origin === 'unclear') return fit('', topic, '没听懂？先把这一步拆开');
  if (origin === 'important') return fit('课堂重点｜', topic, '，回看抓住这一点');
  // A question remains a question: do not insert it into a noun-shaped title slot.
  if (/为什么|为何|怎么|怎样|如何|什么|是否|吗|区别|哪/.test(topic)) return fit('', topic, ['？这次把思路捋顺', '？先抓住关键这一步', '？换个角度再看一次', '？跟着原材料拆开看'][Number.parseInt(salt.slice(0, 2), 16) % 4]);
  return [
    () => fit('', topic, '，先抓住这个关键'),
    () => fit('别急着背', topic, '，先把原理想明白'),
    () => fit('', topic, '，值得换个角度再看一次'),
    () => fit('', topic, '，这次从问题本身讲起'),
  ][Number.parseInt(salt.slice(0, 2), 16) % 4]();
}
export function buildSourceArticle(source) {
  const body = String(source.body || '').trim(), topic = sourceTopic(source);
  const pending = !body;
  const paragraphs = body.split(/\n\s*\n|(?=^#{1,4} )/m).filter((part) => plainText(part).length > 10);
  const meaningful = paragraphs.find((part) => !/^\s*#/.test(part)) || body;
  const digest = plainText(meaningful).slice(0, 180);
  const sourceHash = hashContent({ source, recipe: FEED_RECIPE });
  const title = pending ? `《${source.title}》的这个${source.origin === 'important' ? '重点' : '疑问'}，先替你留住了` : topicTitle(topic, source.origin, sourceHash);
  const lead = source.origin === 'qa' ? `你曾经问过：「${source.question}」。把答案从对话里拿出来，再看一遍真正有用的部分。`
    : source.origin === 'important' ? '上课时特意按下的那个重点，值得在复习时单独拿出来。先看这一段，再顺着材料往下理解。'
    : '当时按下“没听懂”的那一刻，不必急着假装理解。先回到原来的片段，把问题拆小一点。';
  const article = pending ? '这个课程时间点已进入学习流。对应回放字幕就绪后会自动整理；也可以补充一句当时的笔记，继续生成文章。'
    : `${lead}\n\n## 先抓住关键\n\n${digest}\n\n## 顺着原材料，把它讲透\n\n${body}\n\n## 读完，回到你自己的问题\n\n${source.question || `你会怎样用自己的话解释「${topic}」？`}\n\n能复述，再试着举一个适用的场景；还有卡住的地方，可以标记“仍不懂”，下次优先复习。`;
  return { title, topic, dek: pending ? '这次标记，等一句线索就能继续。' : digest, body: article,
    category: feedCategory(`${topic} ${body.slice(0, 600)}`), pending, mode: 'source-edit', recipeVersion: FEED_RECIPE,
    replies: paragraphs.slice(0, 3).map((part, index) => ({ heading: ['先看结论', '再看解释', '继续往下理解'][index], body: part.slice(0, 2200) })),
    myth: source.myth || null, sourceIds: (source.sources || []).map((item) => item.id),
    cover: ['sage', 'cream', 'blue', 'peach'][Number.parseInt(sourceHash.slice(0, 2), 16) % 4],
  };
}
export function validateEditedArticle(value, validSourceIds) {
  if (!value || typeof value !== 'object' || typeof value.title !== 'string' || typeof value.body !== 'string') throw new Error('生成稿缺少标题或正文');
  if (value.title.trim().length < 6 || value.title.length > 100 || value.body.trim().length < 100 || value.body.length > 14000) throw new Error('生成稿长度不符合要求');
  if (!Array.isArray(value.sourceIds) || !value.sourceIds.length || value.sourceIds.some((id) => !validSourceIds.includes(id))) throw new Error('生成稿没有正确关联原始材料');
  const replies = (Array.isArray(value.replies) ? value.replies : []).slice(0, 3).filter((reply) => typeof reply.body === 'string').map((reply) => ({ heading: String(reply.heading || '继续理解').slice(0, 40), body: reply.body.slice(0, 3000) }));
  let myth = null;
  if (value.myth && typeof value.myth.statement === 'string' && typeof value.myth.answer === 'boolean' && typeof value.myth.explanation === 'string') {
    if (!Array.isArray(value.myth.sourceIds) || value.myth.sourceIds.some((id) => !validSourceIds.includes(id)) || !value.myth.sourceIds.length) throw new Error('误区判断缺少来源');
    myth = { statement: value.myth.statement.slice(0, 500), answer: value.myth.answer, explanation: value.myth.explanation.slice(0, 2500), sourceIds: [...new Set(value.myth.sourceIds)] };
  }
  return { title: value.title.trim(), dek: String(value.dek || plainText(value.body).slice(0, 180)).slice(0, 500), body: value.body.trim(), replies, myth,
    sourceIds: [...new Set(value.sourceIds)], mode: 'ai-edit', titleFormula: String(value.titleFormula || '').slice(0, 80) };
}
