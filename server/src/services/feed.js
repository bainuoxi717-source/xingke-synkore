// 信息源抓取与正文提取
// 支持：学校官网列表页（提取文章链接）、公众号文章单篇（提取正文）
import { askDeepSeek } from './ai.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';

export async function fetchPage(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`抓取失败 HTTP ${res.status}`);
  const html = await res.text();
  return { html, finalUrl: res.url };
}

const stripTags = (s) => String(s ?? '')
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&#\d+;/g, '')
  .replace(/\s+/g, ' ')
  .trim();

// 从 URL 或标题里尽力推断发布日期（各站格式不同）
export function inferDate(url, title) {
  const s = `${url} ${title}`;
  let m = s.match(/(20\d{2})[-/年](\d{1,2})[-/月](\d{1,2})/);            // 2026-05-06 / 2026年5月6日
  if (m) return toISO(m[1], m[2], m[3]);
  m = s.match(/\/(20\d{2})(\d{2})(\d{2})\//);                            // /20260506/
  if (m) return toISO(m[1], m[2], m[3]);
  m = s.match(/\/(20\d{2})\/(\d{1,2})\/(\d{1,2})\//);                     // /2026/5/6/
  if (m) return toISO(m[1], m[2], m[3]);
  m = s.match(/(20\d{2})\.(\d{1,2})\.(\d{1,2})/);                         // 2026.5.6
  if (m) return toISO(m[1], m[2], m[3]);
  m = title.match(/(20\d{2})[-年](\d{1,2})[-月](\d{1,2})/);
  if (m) return toISO(m[1], m[2], m[3]);
  return '';
}

function toISO(y, mo, d) {
  const dt = new Date(Number(y), Number(mo) - 1, Number(d));
  if (Number.isNaN(dt.getTime())) return '';
  if (dt.getFullYear() < 2015 || dt.getTime() > Date.now() + 86400000) return '';
  return dt.toISOString().slice(0, 10);
}

// 列表页 → 文章条目
export function extractArticles(html, baseUrl) {
  const out = [];
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = m[1];
    if (/^(javascript|#|mailto|tel)/i.test(href)) continue;
    const text = stripTags(m[2]);
    if (!text || text.length < 8 || text.length > 200) continue;
    let url;
    try { url = new URL(href, baseUrl).href; } catch { continue; }
    if (!/^https?:/.test(url)) continue;
    // 只要像内容页的链接（覆盖交大各站的不同路由风格）
    const isArticle =
      /\/info\/|\/content\.jsp|\/article|\/detail|\/post\/detail|\/Web\/Show|\/Default\/|\/\d{4}\/\d{2}|\/\d{4}-\d{2}-\d{2}|\/s\?|mp\.weixin|index\.php\?|news\.sjtu|show\?|\/List\/|\.html?$/i.test(url);
    if (!isArticle) continue;
    out.push({ title: text, url, published_at: inferDate(url, text) });
  }
  // 按 URL 去重，保持顺序
  return [...new Map(out.map((x) => [x.url, x])).values()];
}

// 从文章正文里推断发布日期（meta 标签 / 常见排版）
export function inferDateFromHtml(html) {
  const pats = [
    /property=["']article:published_time["'][^>]*content=["']([^"']+)["']/i,
    /content=["']([^"']+)["'][^>]*property=["']article:published_time["']/i,
    /name=["'](?:publishdate|pubdate|pub_date|weibo:article:create_at)["'][^>]*content=["']([^"']+)["']/i,
    /(?:发布时间|发布日期|时间|日期)\s*[:：]\s*(20\d{2})[-/年.](\d{1,2})[-/月.](\d{1,2})/,
    /(20\d{2})[-/年.](\d{1,2})[-/月.](\d{1,2})\s*(?:日)?\s*(?:发布|发表|阅读|作者|来源)/,
    /发表于\s*(20\d{2})[-/年.](\d{1,2})[-/月.](\d{1,2})/,
    /(20\d{2})-(\d{2})-(\d{2})[^0-9]{0,12}\d+\s*次阅读/,
    /class=["'][^"']*(?:date|time|pub)[^"']*["'][^>]*>\s*(20\d{2})[-/年.](\d{1,2})[-/月.](\d{1,2})/i,
  ];
  for (const p of pats) {
    const m = html.match(p);
    if (!m) continue;
    if (m.length >= 4 && m[2] !== undefined) {
      const iso = toISO(m[1], m[2], m[3]);
      if (iso) return iso;
    } else if (m[1]) {
      const d = new Date(m[1]);
      if (!Number.isNaN(d.getTime()) && d.getFullYear() >= 2015 && d.getTime() <= Date.now() + 86400000) {
        return d.toISOString().slice(0, 10);
      }
    }
  }
  return '';
}

// 文章页 → 正文（优先微信 js_content，其次常见正文容器）
export function extractArticleContent(html) {
  const pick = (re) => {
    const m = re.exec(html);
    return m ? stripTags(m[1]) : '';
  };
  const candidates = [
    pick(/<div[^>]*id=["']js_content["'][^>]*>([\s\S]*?)<\/div>\s*<div/i),
    pick(/<div[^>]*id=["']js_content["'][^>]*>([\s\S]*?)<\/div>/i),
    pick(/<div[^>]*class=["'][^"']*article[-_]?content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i),
    pick(/<div[^>]*class=["'][^"']*(?:content|detail|news_content|wp_articlecontent)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i),
    pick(/<article[^>]*>([\s\S]*?)<\/article>/i),
    pick(/<body[^>]*>([\s\S]*?)<\/body>/i),
  ];
  let best = '';
  for (const c of candidates) if (c.length > best.length) best = c;
  return best.slice(0, 20000);
}

export function extractTitle(html) {
  const t = (/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1]
    ?? /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1]
    ?? '').trim();
  return stripTags(t).slice(0, 200);
}

// ============ AI 筛选：给条目打重要性 + 写一句话摘要 ============
export async function rankItems(apiKey, items, { model } = {}) {
  const today = new Date();
  const compact = items.map((it, i) => {
    const date = (it.published_at ?? '').slice(0, 10);
    const days = date ? Math.round((today - new Date(date)) / 86400000) : null;
    return {
      i,
      title: it.title,
      source: it.source_name ?? '',
      发布: date || (it.fetched_at ?? '').slice(0, 10),
      已有天数: days,
      snippet: (it.summary ?? '').slice(0, 120),
    };
  });
  const prompt = `今天是 ${today.toLocaleDateString('zh-CN')}（${today.toISOString().slice(0, 10)}）。
以下是上海交通大学学生近期可能相关的信息条目（JSON）。这位学生是媒体与传播学院传播学 2026 级本科生（大一，第 3 周在读）。

请针对每一条判断"对这位学生此刻的重要性"，并给出一句话中文摘要（不超过 40 字，说清是什么事、和他有什么关系）。

⭐⭐ 时效性是硬性要求：
- 凡是"报名/申报/评选/申请/缴费/选课"类通知，**若发布日期距今超过 60 天，最多评 2 分**（窗口大概率已过），并在摘要里注明"可能已过期"。
- 若距今在 30-60 天之间且属申报类，最多评 3 分。
- 纯资讯类（活动报道、成果喜报）距今超过 90 天的一律 ≤1 分。

评分标准：5=此刻就需要他行动（选课/考试/学分/报名截止/评奖，且窗口在近期）；4=学院或专业相关且时效性还好；3=学校层面值得知道；2=一般资讯；1=无关或已过期。

严格只输出 JSON 数组，元素形如 {"i":0,"score":5,"tags":["选课","截止"],"digest":"..."}，不要输出其他文字。`;

  const raw = await askDeepSeek(
    apiKey,
    '你是上海交通大学学生的信息筛选助手，只输出严格 JSON。',
    `${prompt}\n\n条目：\n${JSON.stringify(compact)}`,
    { thinking: 'off', maxTokens: 4000, temperature: 0.3, model }
  );
  let arr = [];
  try {
    arr = JSON.parse(raw.replace(/```json|```/g, '').trim());
    if (!Array.isArray(arr)) arr = [];
  } catch {
    const m = raw.match(/\[[\s\S]*\]/);
    if (m) { try { arr = JSON.parse(m[0]); } catch { arr = []; } }
  }
  return arr;
}

// ============ AI 简报：把当日重点合成一段简报 ============
export async function buildDigest(apiKey, items, { model } = {}) {
  const lines = items.map((it) => `- [${it.ai_score ?? '-'}] ${it.title}（${it.source_name ?? ''}）：${it.ai_digest ?? it.summary ?? ''}`);
  return await askDeepSeek(
    apiKey,
    '你是上海交通大学学生的每日信息助理。用简洁中文写一段 150-250 字的"今日重点简报"，按重要性排序，指出**需要他行动的**事项（报名/截止/选课/考试）。',
    `今天是 ${new Date().toLocaleDateString('zh-CN')}。候选信息：\n${lines.join('\n')}`,
    { thinking: 'off', maxTokens: 2000, temperature: 0.5, model }
  );
}
