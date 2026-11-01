import { hashContent, parseJSON } from './learning-feed-core.js';
import { FORMATS, interestKind } from './feed-editorial.js';
import { WRITER_DEFINITIONS } from './feed-writers.js';
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const validID = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const fail = (message) => Object.assign(new Error(message), { status: 400 });
const features = (post) => ({ interest: String(post.interest || ''), kind: String(post.sceneKind || interestKind(post.interest || '')), format: String(post.format || ''), cover: post.cover?.type === 'text' ? 'text' : 'photo', writer: post.mode === 'ai-edit' && WRITER_DEFINITIONS.some((w) => w.id === post.writer?.id) ? post.writer.id : '' });
const formatWords = { lyrics: /歌词|副歌/, poem: /诗文|诗歌|写诗|诗句|小诗/, rebuttal: /辩驳|反驳|不同立场/, analysis: /解读|分析|讲解/ };

export function commentPreference(text, post, interests) {
  // An argument's stance is not a preference. Ignore quotations and hypothetical attribution.
  const statements = String(text).replace(/[“「『][^”」』]*[”」』]/g, '').split(/[。！？!，,；;\n]/).filter((s) => !/有人说|他认为|她认为|假如|如果|不代表|不是不喜欢|并非不喜欢/.test(s));
  const output = [];
  for (const sentence of statements) {
    const dislike = /不(?:太|怎么|是很)?喜欢|没(?:什么)?兴趣|不(?:太)?感兴趣|看腻|讨厌|少(?:给我)?推|别(?:再)?推|不要(?:再)?推|不想(?:再)?看/.test(sentence);
    const like = /(?:更|很|挺|比较|特别)?喜欢|爱看|想多看|多(?:给我)?推|多来点|多写点|更想看/.test(sentence);
    if (!dislike && !like) continue;
    const value = dislike ? -1 : 1;
    const targets = interests.filter((name) => sentence.includes(name) || (name === '诺兰的电影' && /诺兰/.test(sentence)) || (name === '刺激战场' && /和平精英|刺激战场/.test(sentence)));
    for (const name of targets) output.push({ feature: 'interest', value: name, direction: value, quote: sentence.trim().slice(0, 160) });
    const styles = WRITER_DEFINITIONS.filter((writer) => sentence.includes(writer.id) || sentence.includes(writer.label));
    if (!styles.length && post.mode === 'ai-edit' && /这(?:种|个|类)(?:写法|风格|讲法)/.test(sentence)) { const current = WRITER_DEFINITIONS.find((writer) => writer.id === post.writer?.id); if (current) styles.push(current); }
    for (const writer of styles) output.push({ feature: 'writer', value: writer.id, direction: value, quote: sentence.trim().slice(0, 160) });
    for (const [format, pattern] of Object.entries(formatWords)) if (pattern.test(sentence)) output.push({ feature: 'format', value: format, direction: value, quote: sentence.trim().slice(0, 160) });
    if (!targets.length && !styles.length && !Object.values(formatWords).some((pattern) => pattern.test(sentence)) && /这类|这种题材|这个题材/.test(sentence)) output.push({ feature: 'interest', value: post.interest, direction: value, quote: sentence.trim().slice(0, 160) });
  }
  return [...new Map(output.map((item) => [`${item.feature}:${item.value}`, item])).values()];
}

export function createFeedPersonalization({ q, q1, run, preferences, nowISO = () => new Date().toISOString() }) {
  function initialize() {
    run(`CREATE TABLE IF NOT EXISTS learning_feed_behavior(id TEXT PRIMARY KEY,post_id TEXT NOT NULL REFERENCES learning_feed_posts(id) ON DELETE CASCADE,type TEXT NOT NULL,features_json TEXT NOT NULL,created_at TEXT NOT NULL)`);
    run(`CREATE TABLE IF NOT EXISTS learning_feed_views(id TEXT PRIMARY KEY,post_id TEXT NOT NULL REFERENCES learning_feed_posts(id) ON DELETE CASCADE,features_json TEXT NOT NULL,active_ms INTEGER NOT NULL DEFAULT 0,scroll REAL NOT NULL DEFAULT 0,opened_at TEXT NOT NULL,updated_at TEXT NOT NULL)`);
    run(`CREATE TABLE IF NOT EXISTS learning_feed_taste(post_id TEXT PRIMARY KEY REFERENCES learning_feed_posts(id) ON DELETE CASCADE,value INTEGER NOT NULL,features_json TEXT NOT NULL,updated_at TEXT NOT NULL)`);
    run(`CREATE TABLE IF NOT EXISTS learning_feed_comment_signals(comment_id TEXT PRIMARY KEY REFERENCES learning_feed_comments(id) ON DELETE CASCADE,post_id TEXT NOT NULL,features_json TEXT NOT NULL,signals_json TEXT NOT NULL,created_at TEXT NOT NULL)`);
    run('CREATE TABLE IF NOT EXISTS learning_feed_learning_state(id TEXT PRIMARY KEY,value TEXT NOT NULL)');
  }
  const state = () => ({ enabled: true, resetAt: '', ...parseJSON(q1("SELECT value FROM learning_feed_learning_state WHERE id='local'")?.value, {}) });
  function ingestComment(post, comment) {
    const current = state();
    if (!current.enabled || comment.created_at <= current.resetAt || (current.pausedPeriods || []).some(([start, end]) => comment.created_at >= start && (!end || comment.created_at <= end))) return;
    const signals = commentPreference(comment.text, post, preferences().interests);
    run('INSERT OR IGNORE INTO learning_feed_comment_signals(comment_id,post_id,features_json,signals_json,created_at) VALUES(?,?,?,?,?)', comment.id, post.id, JSON.stringify(features(post)), JSON.stringify(signals), comment.created_at);
  }
  function backfillComments() {
    if (!state().enabled) return;
    for (const row of q(`SELECT c.id,c.post_id,c.text,c.created_at,p.article_json FROM learning_feed_comments c JOIN learning_feed_posts p ON p.id=c.post_id LEFT JOIN learning_feed_comment_signals s ON s.comment_id=c.id WHERE c.kind='user' AND s.comment_id IS NULL AND c.created_at>? ORDER BY c.created_at LIMIT 500`, state().resetAt)) ingestComment({ id: row.post_id, ...parseJSON(row.article_json, {}) }, row);
  }
  function signal(post, input = {}) {
    if (!state().enabled && input.type !== 'preference') return { ok: true, ignored: true };
    if (!validID(input.id) || !['impression', 'open', 'read', 'preference'].includes(input.type)) throw fail('阅读反馈格式无效');
    const at = nowISO(), snapshot = features(post), existing = q1('SELECT post_id,type FROM learning_feed_behavior WHERE id=?', input.id);
    if (existing) { if (existing.post_id !== post.id || existing.type !== input.type) throw fail('反馈编号已用于其他内容'); return { ok: true, duplicate: true }; }
    if (input.type === 'preference') {
      if (!['more', 'less', 'neutral'].includes(input.value)) throw fail('请选择多看、少看或取消');
      run('INSERT INTO learning_feed_taste(post_id,value,features_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(post_id) DO UPDATE SET value=excluded.value,features_json=excluded.features_json,updated_at=excluded.updated_at', post.id, input.value === 'more' ? 1 : input.value === 'less' ? -1 : 0, JSON.stringify(snapshot), at);
    } else if (input.type === 'open') {
      if (!validID(input.visitId)) throw fail('阅读会话编号无效');
      const view = q1('SELECT post_id FROM learning_feed_views WHERE id=?', input.visitId);
      if (view && view.post_id !== post.id) throw fail('阅读会话不属于这篇推文');
      run('INSERT OR IGNORE INTO learning_feed_views(id,post_id,features_json,opened_at,updated_at) VALUES(?,?,?,?,?)', input.visitId, post.id, JSON.stringify(snapshot), at, at);
    } else if (input.type === 'read') {
      const view = q1('SELECT * FROM learning_feed_views WHERE id=? AND post_id=?', input.visitId, post.id); if (!view) throw fail('请先打开这篇推文');
      if (!Number.isFinite(input.activeMs) || !Number.isFinite(input.scroll)) throw fail('有效阅读数据无效');
      const elapsed = Math.max(0, Date.parse(at) - Date.parse(view.opened_at));
      const active = Math.floor(clamp(input.activeMs, 0, Math.min(30 * 60000, elapsed + 2000)));
      run('UPDATE learning_feed_views SET active_ms=MAX(active_ms,?),scroll=MAX(scroll,?),updated_at=? WHERE id=?', active, clamp(input.scroll, 0, 1), at, view.id);
    } else {
      if (!validID(input.sessionId) || !Number.isFinite(input.visibleMs) || input.visibleMs < 1000) throw fail('只有实际进入视野的卡片才记录曝光');
      const day = new Date(Date.parse(at) + 8 * 3600000).toISOString().slice(0, 10), id = `im-${hashContent({ post: post.id, session: input.sessionId, day }).slice(0, 38)}`;
      if (q1('SELECT id FROM learning_feed_behavior WHERE id=?', id)) return { ok: true, duplicate: true };
      input = { ...input, id };
    }
    run('INSERT INTO learning_feed_behavior(id,post_id,type,features_json,created_at) VALUES(?,?,?,?,?)', input.id, post.id, input.type, JSON.stringify(snapshot), at);
    return { ok: true };
  }
  function profile() {
    backfillComments(); const current = state(), now = Date.parse(nowISO()), scores = new Map(), evidence = [];
    const decay = (at) => Math.exp(-Math.max(0, now - Date.parse(at)) / (21 * 86400000));
    const add = (feature, value, delta) => { if (!value) return; const key = `${feature}:${value}`; scores.set(key, (scores.get(key) || 0) + delta); };
    const addAll = (snapshot, delta) => { for (const key of ['interest', 'kind', 'format', 'cover', 'writer']) add(key, snapshot[key], delta * (key === 'interest' ? 1 : key === 'cover' ? .25 : key === 'writer' ? .6 : .4)); };
    const views = q('SELECT * FROM learning_feed_views ORDER BY updated_at DESC LIMIT 3000'), byPostDay = new Map();
    for (const view of views) { const key = `${view.post_id}:${view.opened_at.slice(0, 10)}`; const bucket = byPostDay.get(key) || []; if (bucket.length < 3) { bucket.push(view); byPostDay.set(key, bucket); } }
    for (const entries of byPostDay.values()) for (const [index, view] of entries.entries()) {
      const snapshot = parseJSON(view.features_json, {}), reading = view.active_ms >= 12000 ? Math.min(1.5, view.active_ms / 35000) * (.7 + view.scroll * .3) : view.active_ms < 3000 ? -.15 : .05;
      addAll(snapshot, (reading + .12 / (index + 1)) * decay(view.updated_at));
    }
    const comments = q('SELECT * FROM learning_feed_comment_signals ORDER BY created_at DESC LIMIT 2000');
    for (const comment of comments) {
      const snapshot = parseJSON(comment.features_json, {}); addAll(snapshot, .18 * decay(comment.created_at));
      for (const signal of parseJSON(comment.signals_json, [])) { add(signal.feature, signal.value, signal.direction * 2 * decay(comment.created_at)); evidence.push({ ...signal, postId: comment.post_id }); }
    }
    const explicit = q('SELECT * FROM learning_feed_taste WHERE value!=0');
    for (const item of explicit) { const snapshot = parseJSON(item.features_json, {}); addAll(snapshot, item.value * 3); }
    const impressions = Number(q1("SELECT COUNT(*) AS n FROM learning_feed_behavior WHERE type='impression'")?.n || 0);
    const values = [...scores].map(([key, value]) => { const separator = key.indexOf(':'); return { feature: key.slice(0, separator), value: key.slice(separator + 1), score: Number(clamp(value, -6, 6).toFixed(2)) }; });
    const effective = views.filter((view) => view.active_ms >= 12000).length;
    return { enabled: current.enabled, resetAt: current.resetAt, values, evidence: evidence.slice(0, 8), stats: { impressions, opens: views.length, effectiveReads: effective, comments: comments.length, activeSeconds: Math.round(views.reduce((sum, view) => sum + view.active_ms, 0) / 1000) },
      confidence: effective + comments.length >= 5 ? '已有一些阅读依据，仍会保留新题材' : '正在积累阅读反馈', explicit: explicit.map((item) => ({ postId: item.post_id, value: item.value })) };
  }
  function creativeBrief(post, learned = profile()) {
    const by = (feature, sign) => learned.values.filter((s) => s.feature === feature && (sign > 0 ? s.score > .3 : s.score < -.5)).sort((a, b) => sign * (b.score - a.score)).slice(0, 4).map((s) => ({ value: s.value, strength: Math.round(s.score) }));
    return { interest: post.interest, preferredInterests: learned.enabled ? by('interest', 1) : [], avoidInterests: learned.enabled ? by('interest', -1) : [], preferredFormats: learned.enabled ? by('format', 1) : [], preferredWriters: learned.enabled ? by('writer', 1) : [],
      instruction: '这些是题材与表达偏好的弱信号，不代表用户赞同文章观点或已经掌握知识。优先解释本次真实材料，尝试新的具体场景，避免套用上一条故事；原始评论不发送给创作模型。' };
  }
  function choice(source, prefs) {
    const learned = profile(), salt = parseInt(hashContent(source.key).slice(0, 7), 16), explore = salt % 5 === 0;
    const weight = (feature, value) => learned.enabled && !explore ? clamp(learned.values.find((s) => s.feature === feature && s.value === value)?.score || 0, -3, 3) : 0;
    const pick = (values, feature) => [...values].sort((a, b) => (weight(feature, b) + parseInt(hashContent(`${source.key}:${b}`).slice(0, 4), 16) / 65535) - (weight(feature, a) + parseInt(hashContent(`${source.key}:${a}`).slice(0, 4), 16) / 65535))[0];
    return { interest: source.editorialTopic?.interestMatches?.find((value) => prefs.interests.includes(value)) || pick(prefs.interests, 'interest'), format: prefs.defaultFormat === 'mix' ? pick(FORMATS.map((f) => f.id), 'format') : prefs.defaultFormat, choiceOrigin: explore ? 'explore' : 'reading-feedback' };
  }
  function rank(posts) {
    const learned = profile(), views = q('SELECT post_id,MAX(updated_at) AS last_read FROM learning_feed_views WHERE active_ms>=12000 GROUP BY post_id');
    const recent = new Map(views.map((v) => [v.post_id, v.last_read]));
    const scored = posts.map((post) => {
      const f = features(post), relevant = learned.values.filter((s) => f[s.feature] === s.value), affinity = learned.enabled ? clamp(relevant.reduce((sum, s) => sum + s.score * (s.feature === 'interest' ? .65 : .2), 0), -4, 4) : 0;
      const readHours = (Date.parse(nowISO()) - Date.parse(recent.get(post.id))) / 3600000, fatigue = learned.enabled && Number.isFinite(readHours) ? readHours < 8 ? 4 : readHours < 48 ? 1.5 : 0 : 0;
      const explicit = learned.explicit.find((e) => e.postId === post.id)?.value || 0;
      return { ...post, personalPreference: explicit > 0 ? 'more' : explicit < 0 ? 'less' : '', recommendationScore: post.priority + affinity - fatigue + explicit * 4,
        recommendationReason: explicit > 0 ? '你希望多看这类内容' : affinity > .8 ? `结合你对${post.interest}的阅读和互动` : fatigue ? '已读内容稍后再回看' : post.reason };
    }).sort((a, b) => b.recommendationScore - a.recommendationScore || String(b.createdAt).localeCompare(String(a.createdAt)) || a.id.localeCompare(b.id));
    const result = [], remaining = [...scored];
    while (remaining.length) {
      const i = result.length, last = result.at(-1), textWanted = [1, 4, 8].includes(i % 10);
      const candidate = remaining.slice(0, 16).map((post, index) => ({ index, utility: post.recommendationScore - (last?.interest === post.interest ? 2.4 : 0) - (last?.sceneKind === post.sceneKind ? .7 : 0) + ((post.cover?.type === 'text') === textWanted ? .7 : 0)
        + (i % 5 === 4 && !result.slice(-5).some((p) => p.interest === post.interest) ? 1.6 : 0) })).sort((a, b) => b.utility - a.utility)[0];
      const post = remaining.splice(candidate.index, 1)[0]; result.push(post);
    }
    return result;
  }
  function reset() { run('DELETE FROM learning_feed_behavior'); run('DELETE FROM learning_feed_views'); run('DELETE FROM learning_feed_taste'); run('DELETE FROM learning_feed_comment_signals'); const value = { ...state(), resetAt: nowISO() }; run("INSERT INTO learning_feed_learning_state(id,value) VALUES('local',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value", JSON.stringify(value)); return { ok: true, profile: profile() }; }
  function configure(enabled) {
    if (typeof enabled !== 'boolean') throw fail('自动学习开关无效');
    const current = state(), periods = current.pausedPeriods || [];
    if (current.enabled !== enabled) { if (!enabled) periods.push([nowISO(), '']); else if (periods.at(-1) && !periods.at(-1)[1]) periods.at(-1)[1] = nowISO(); }
    run("INSERT INTO learning_feed_learning_state(id,value) VALUES('local',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value", JSON.stringify({ ...current, pausedPeriods: periods, enabled }));
    return { ok: true, profile: profile() };
  }
  function removePost(id) { for (const table of ['learning_feed_behavior', 'learning_feed_views', 'learning_feed_taste', 'learning_feed_comment_signals']) run(`DELETE FROM ${table} WHERE post_id=?`, id); }
  const taste = (id) => { const value = q1('SELECT value FROM learning_feed_taste WHERE post_id=?', id)?.value || 0; return value > 0 ? 'more' : value < 0 ? 'less' : ''; };
  return { initialize, signal, profile, creativeBrief, choice, rank, reset, configure, removePost, ingestComment, taste };
}
