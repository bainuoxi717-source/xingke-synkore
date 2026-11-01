import { hashContent, parseJSON, retrieveSourceChunks } from './learning-feed-core.js';
import { randomUUID } from 'node:crypto';

const fail = (status, message) => Object.assign(new Error(message), { status });
export const TOPIC_SEARCH_VERSION = 'daily-topics-v1';
export const SEARCH_PRICE_USD = .00075;
export const shanghaiDay = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const clean = (text) => String(text || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
export function publicTopicURL(value) {
  try { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || /^(?:localhost|127\.|10\.|192\.168\.|0\.|\[?::1)/i.test(url.hostname) || url.hostname.endsWith('.local')) return ''; for (const key of [...url.searchParams.keys()]) if (/^utm_|^(?:from|spm)$/i.test(key)) url.searchParams.delete(key); return url.href; } catch { return ''; }
}
export function interestMatches(title, summary, interests) {
  const text = `${title} ${summary}`.toLowerCase();
  return interests.filter((interest) => {
    if (interest === '诺兰的电影') return /诺兰|christopher nolan/.test(text);
    if (interest === '情感片') return /爱情|情感|恋爱|分手|爱情片/.test(text);
    if (interest === '刺激战场') return /刺激战场|和平精英|pubg/.test(text);
    if (interest === '三角洲') return /三角洲行动|delta force/.test(text) || (/三角洲/.test(text) && /游戏|手游|赛季/.test(text));
    return text.includes(interest.toLowerCase());
  });
}
export function parseBaiduBoard(html, { board, label, interests, observedAt }) {
  const match = String(html).match(/<!--s-data:([\s\S]*?)-->/);
  if (!match) throw new Error(`${label}没有返回可读取的榜单`);
  const data = JSON.parse(match[1]);
  const content = (data.data?.cards || []).flatMap((card) => card.content || []);
  return content.slice(0, 60).map((item, index) => {
    const title = clean(item.word || item.query), summary = clean(item.desc).slice(0, 180), url = publicTopicURL(item.rawUrl || item.url);
    if (!title || !url) return null;
    const matches = interestMatches(title, summary, interests);
    return { id: `t-${hashContent({ day: shanghaiDay(new Date(observedAt)), board, title, url }).slice(0, 28)}`, title, summary, url, kind: 'ranked',
      sourceName: label, provider: 'baidu-public', rank: item.isTop ? null : Number.isFinite(Number(item.index)) ? Number(item.index) + 1 : index + 1,
      interestMatches: matches, observedAt, publishedAt: null, boardUpdatedAt: data.data?.cards?.[0]?.updateTime || null };
  }).filter(Boolean);
}
export function normalizeSearchResults(results, { interests, observedAt, query }) {
  const cutoff = Date.parse(observedAt) - 7 * 86400000;
  return (Array.isArray(results) ? results : []).map((item) => {
    const url = publicTopicURL(item.url), title = clean(item.title), date = Date.parse(item.date || '');
    if (!url || !title || (Number.isFinite(date) && (date > Date.parse(observedAt) + 300000 || date < cutoff))) return null;
    const summary = clean(item.summary || item.snippet).slice(0, 900);
    return { id: `t-${hashContent({ url, title, publishedAt: Number.isFinite(date) ? date : shanghaiDay(new Date(observedAt)) }).slice(0, 28)}`,
      title, summary, url, kind: Number.isFinite(date) ? 'news' : 'undated', provider: 'deepseek-search', sourceName: clean(item.site_name) || new URL(url).hostname,
      interestMatches: interestMatches(title, summary, interests), publishedAt: Number.isFinite(date) ? new Date(date).toISOString() : null, observedAt, query };
  }).filter(Boolean);
}
export function dailyQueries(interests, now = new Date()) {
  const since = shanghaiDay(new Date(+now - 3 * 86400000)), groups = [[], [], []];
  for (const item of interests) groups[/电影|情感片|影视|诺兰/.test(item) ? 1 : /荣耀|战场|三角洲|游戏/.test(item) ? 2 : 0].push(item === '诺兰的电影' ? '诺兰 电影' : item === '刺激战场' ? '和平精英' : item === '三角洲' ? '三角洲行动' : item);
  return groups.filter((group) => group.length).slice(0, 3).map((group) => `(${group.slice(0, 5).join(' OR ')}) after:${since} lang:zh`.slice(0, 128));
}
async function fetchBoard(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(9000), headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' } });
  if (!response.ok) throw new Error(`榜单返回 HTTP ${response.status}`);
  const reader = response.body.getReader(), chunks = []; let size = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('榜单页面过大'); } chunks.push(value); }
  return Buffer.concat(chunks).toString('utf8');
}
export async function searchDeepSeek(apiKey, query) {
  const response = await fetch('https://api.deepseek.com/v1/tools/search', { method: 'POST', signal: AbortSignal.timeout(25000), headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, count: 8, need_content: false }) });
  if (!response.ok) throw fail(response.status, response.status === 402 ? 'DeepSeek余额不足，本次搜索停止，未重试剩余查询' : `DeepSeek搜索失败 HTTP ${response.status}`);
  return (await response.json()).results || [];
}
export function createFeedTopics({ q, q1, run, preferences, getSettings, createDrafts, getCandidates, nowISO = () => new Date().toISOString(), readBoard = fetchBoard, search = searchDeepSeek }) {
  let active = false, timer, firstTimer;
  function initialize() {
    run('CREATE TABLE IF NOT EXISTS learning_feed_topics(id TEXT PRIMARY KEY,topic_json TEXT NOT NULL,observed_at TEXT NOT NULL)');
    run('CREATE TABLE IF NOT EXISTS learning_feed_topic_runs(id TEXT PRIMARY KEY,day TEXT NOT NULL,provider TEXT NOT NULL,status TEXT NOT NULL,details_json TEXT NOT NULL,created_at TEXT NOT NULL)');
    run('CREATE TABLE IF NOT EXISTS learning_feed_search_plans(id TEXT PRIMARY KEY,request_hash TEXT NOT NULL,state TEXT NOT NULL,plan_json TEXT NOT NULL,created_at TEXT NOT NULL)');
    run("UPDATE learning_feed_search_plans SET state='interrupted' WHERE state='processing'");
  }
  const candidates = () => getCandidates().filter((post) => !post.pending && post.feedback !== 'mastered');
  function withSuggestions(topic, posts) {
    const matches = retrieveSourceChunks(posts.map((post) => ({ id: post.id, text: `${post.source.question || ''} ${post.topic || ''} ${post.source.body || ''}`.slice(0, 8000) })), `${topic.title} ${topic.summary}`, 1);
    const chosen = (matches.length && posts.find((post) => post.id === matches[0].id)) || posts[0];
    const draft = q1("SELECT id FROM learning_feed_posts WHERE source_key LIKE ? ORDER BY created_at DESC LIMIT 1", `trend:${topic.id}:%`);
    return { ...topic, draftPostId: draft?.id || null, suggestedPostId: chosen?.id || null, suggestedKnowledge: chosen?.topic || '', suggestionBasis: matches.length ? '材料关键词相关' : '先从未掌握的材料选题' };
  }
  function list() {
    const day = shanghaiDay(new Date(nowISO())), posts = candidates();
    const topics = q('SELECT * FROM learning_feed_topics ORDER BY observed_at DESC LIMIT 240').map((row) => parseJSON(row.topic_json)).filter(Boolean)
      .filter((topic) => Date.parse(nowISO()) - Date.parse(topic.observedAt) < 8 * 86400000).sort((a, b) => b.interestMatches.length - a.interestMatches.length || String(b.observedAt).localeCompare(String(a.observedAt)) || (a.rank || 100) - (b.rank || 100));
    return { ok: true, topics: topics.slice(0, 50).map((topic) => withSuggestions(topic, posts)), today: day, running: active,
      lastRun: parseJSON(q1('SELECT details_json FROM learning_feed_topic_runs ORDER BY created_at DESC,id DESC LIMIT 1')?.details_json),
      schedule: { time: '08:30', timezone: 'Asia/Shanghai', provider: 'baidu-public', autoDraftLimit: 3 }, configured: !!getSettings().deepseekKey,
      searchPrice: { perRequestUSD: SEARCH_PRICE_USD, checkedAt: '2026-11-01', url: 'https://api-docs.deepseek.com/guides/search/' } };
  }
  function saveTopics(items) {
    for (const topic of items) run('INSERT INTO learning_feed_topics(id,topic_json,observed_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET topic_json=excluded.topic_json,observed_at=excluded.observed_at', topic.id, JSON.stringify(topic), topic.observedAt);
  }
  function record(provider, status, details) {
    const at = nowISO(), value = { ...details, provider, status, at };
    run('INSERT INTO learning_feed_topic_runs(id,day,provider,status,details_json,created_at) VALUES(?,?,?,?,?,?)', `r-${randomUUID()}`, shanghaiDay(new Date(at)), provider, status, JSON.stringify(value), at);
  }
  async function refreshFree({ automatic = false } = {}) {
    if (active) return { ...list(), alreadyRunning: true };
    active = true;
    try {
      const observedAt = nowISO(), interests = preferences().interests;
      const boards = [['realtime', '百度热搜'], ['movie', '百度电影榜'], ['game', '百度游戏榜']];
      const results = await Promise.allSettled(boards.map(async ([board, label]) => parseBaiduBoard(await readBoard(`https://top.baidu.com/board?tab=${board}`), { board, label, interests, observedAt })));
      const items = results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
      const errors = results.filter((result) => result.status === 'rejected').map((result) => String(result.reason?.message || '来源暂时不可达'));
      saveTopics(items);
      const matched = items.filter((item) => item.interestMatches.length), drafts = matched.length ? createDrafts(matched, 3) : [];
      record('baidu-public', errors.length === boards.length ? 'error' : errors.length ? 'partial' : 'ok', { scanned: items.length, matched: matched.length, drafts: drafts.length, errors, automatic, modelCalls: 0 });
      return { ...list(), running: false, draftIds: drafts };
    } finally { active = false; }
  }
  function searchSpec() {
    const queries = dailyQueries(preferences().interests, new Date(nowISO()));
    return { ok: true, provider: 'deepseek-search', configured: !!getSettings().deepseekKey, queries, calls: queries.length, maxSearchCostUSD: Number((queries.length * SEARCH_PRICE_USD).toFixed(6)),
      pricingCheckedAt: '2026-11-01', pricingUrl: 'https://api-docs.deepseek.com/guides/search/', version: TOPIC_SEARCH_VERSION,
      requestHash: hashContent({ queries, day: shanghaiDay(new Date(nowISO())), price: SEARCH_PRICE_USD, version: TOPIC_SEARCH_VERSION, account: hashContent(getSettings().deepseekKey || '') }) };
  }
  function searchPlan() {
    const plan = { ...searchSpec(), planId: `sp-${randomUUID()}` };
    run("INSERT INTO learning_feed_search_plans(id,request_hash,state,plan_json,created_at) VALUES(?,?,'pending',?,?)", plan.planId, plan.requestHash, JSON.stringify(plan), nowISO());
    return plan;
  }
  async function searchNow(approval = {}) {
    if (!approval.approved) return { ok: false, needsConfirmation: true, plan: searchPlan() };
    const saved = q1('SELECT * FROM learning_feed_search_plans WHERE id=?', approval.planId);
    if (!saved) throw fail(409, '请先核对本次搜索计划');
    const plan = parseJSON(saved.plan_json);
    if (saved.state !== 'pending') return { ...list(), duplicate: true };
    if (Date.parse(nowISO()) - Date.parse(saved.created_at) > 30 * 60000) throw fail(409, '搜索确认已过期，请重新核对');
    if (!plan.configured) throw fail(400, '请先在设置中配置DeepSeek API Key');
    if (plan.requestHash !== approval.requestHash || plan.requestHash !== searchSpec().requestHash || plan.version !== approval.version) throw fail(409, '日期、兴趣或搜索方案已变化，请重新确认');
    if (active) throw fail(409, '选题Agent正在检索，请稍后查看');
    active = true;
    run("UPDATE learning_feed_search_plans SET state='processing' WHERE id=?", plan.planId);
    const items = [], errors = []; let completedCalls = 0;
    try {
      for (const query of plan.queries) {
        if (searchSpec().requestHash !== plan.requestHash) {
          errors.push('日期、兴趣或搜索账户已变化，剩余查询停止，请重新确认');
          break;
        }
        try { const results = await search(getSettings().deepseekKey, query); completedCalls++; const batch = normalizeSearchResults(results, { interests: preferences().interests, observedAt: nowISO(), query }); items.push(...batch); saveTopics(batch); }
        catch (error) { errors.push(error.message || '搜索未完成'); break; } // No silent paid retries.
      }
      saveTopics(items);
      const unique = [...new Map(items.map((item) => [item.id, item])).values()];
      const usable = unique.filter((item) => item.kind === 'news' && item.interestMatches.length), drafts = usable.length ? createDrafts(usable, 3) : [];
      record('deepseek-search', errors.length ? 'partial' : 'ok', { scanned: items.length, matched: usable.length, drafts: drafts.length, errors, completedCalls, writingCalls: 0 });
      return { ...list(), running: false, draftIds: drafts };
    } finally { active = false; run("UPDATE learning_feed_search_plans SET state='complete' WHERE id=?", plan.planId); }
  }
  function useTopic(id, postId) {
    const topic = parseJSON(q1('SELECT topic_json FROM learning_feed_topics WHERE id=?', id)?.topic_json);
    if (!topic) throw fail(404, '选题线索不存在');
    if (Date.parse(nowISO()) - Date.parse(topic.observedAt) > 8 * 86400000) throw fail(400, '这条线索已经较旧，请先刷新选题池');
    const draftIds = createDrafts([topic], 1, postId);
    if (!draftIds.length) throw fail(400, '先准备一段有文字依据的学习材料');
    return { ok: true, postId: draftIds[0] };
  }
  function start() {
    let stopped = false;
    const dailyState = () => {
      const date = new Date(nowISO()), day = shanghaiDay(date), target = Date.parse(`${day}T08:30:00+08:00`);
      const successful = q1("SELECT id FROM learning_feed_topic_runs WHERE day=? AND provider='baidu-public' AND status IN('ok','partial') AND created_at>=? LIMIT 1", day, new Date(target).toISOString());
      return { date, target, successful };
    };
    const tick = async () => {
      const current = dailyState();
      if (!current.successful && +current.date >= current.target && !active) { try { await refreshFree({ automatic: true }); } catch { /* Only public sources are retried. */ } }
      if (stopped) return;
      const next = dailyState();
      const delay = +next.date < next.target ? next.target - +next.date : next.successful ? next.target + 86400000 - +next.date : 30 * 60000;
      timer = setTimeout(tick, Math.max(1000, delay));
    };
    firstTimer = setTimeout(tick, 1000);
    return () => { stopped = true; clearTimeout(firstTimer); clearTimeout(timer); };
  }
  return { initialize, list, refreshFree, searchPlan, searchNow, useTopic, start };
}
