// Browser-local public demonstration. No server credentials or real classroom data.
import seedFeed from './feed.json';
import replay from './replay.json';
import courses from './courses.json';

const KEY = 'synkore:public-demo:v1';
const blank = () => ({ posts: structuredClone(seedFeed.posts), sessions: [], marks: [], replayMarks: [], comments: Object.fromEntries(seedFeed.posts.map(p => [p.id, (p.seedComments || []).map((c, i) => ({ id: `preset-${p.id}-${i}`, kind: 'seed', name: ['先别急着同意', '把依据放桌上', '换个角度想'][i % 3], provider: 'preset', text: typeof c === 'string' ? c : c.text, createdAt: p.createdAt }))])), preferences: { interests: ['王者荣耀', '诺兰的电影', '周杰伦'], defaultFormat: 'mix' } });
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || blank(); } catch { return blank(); } };
let state;
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} };
const teacher = '林老师（虚构）', subject = '实验设计入门（公开示例）';
const personas = [{ id: 'assistant', name: '学习助手', kind: 'assistant', ready: true, version: 'public-demo' }, { id: 'skill:feynman', name: '费曼式直观讲解', kind: 'skill', ready: true, version: 'public-demo' }];
const lectures = courses.map(c => ({ cour_id: c.courId, subj_name: subject, teacher, leti_number: c.number, begin_time: c.date + ' 09:00:00', duration_sec: 300, transcript: c.segments.map(s => s.text).join('\n'), transcript_chars: c.segments.map(s => s.text).join('').length }));
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const stream = events => {
  const encoder = new TextEncoder(); let timer;
  return new Response(new ReadableStream({ start(controller) {
    let i = 0; const next = () => { if (i >= events.length) { controller.close(); return; } const [event, data] = events[i++]; controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); timer = setTimeout(next, 20); }; next();
  }, cancel() { clearTimeout(timer); } }), { headers: { 'Content-Type': 'text/event-stream' } });
};
const responseEvents = (text, evidence, sessionId) => [['evidence', evidence], ...text.match(/[\s\S]{1,25}/g).map(text => ['delta', { text }]), ['done', { ok: true, full: text, sessionId, markdown: text, coverage: 'partial' }]];
const restyled = '## 换一个直观讲法\n\n> 预设演示讲解，未调用在线模型。\n\n想象你想知道一种复习方法是否有效：\n\n1. **先测一次**，看看原来的水平，这就是前测。\n2. **改变复习方法**，这是自变量 X。\n3. **再测一次**，记录结果 Y，这就是后测。\n4. **找比较条件**，同时检查练习时间、原有水平等其他解释。\n\n分数提高是观察结果，还需要检查其他因素，才能讨论因果。\n\n### 原文索引\n公开示例课 · 第2节 · 00:36 前测与比较基线。';
function answer(question, lectureId, persona) {
  const lesson = courses.find(c => c.courId === Number(lectureId)) || courses[1];
  let chosen = lesson.segments.find(s => /前测/.test(question) && /前测/.test(s.text));
  if (!chosen) chosen = lesson.segments.find(s => /因果|相关/.test(question) && /因果/.test(s.text));
  if (!chosen) chosen = lesson.segments.find(s => /变量|刺激/.test(question) && /自变量/.test(s.text));
  if (!chosen && /重点|核心|例子|这一课|实验|讲法/.test(question)) chosen = lesson.segments[0];
  if (!chosen) return { text: '这是预设内容演示，当前没有调用在线模型。\n\n可以选择第2节课，试问「前测是什么？」、「实验里自变量和因变量有什么区别？」或「这节课的重点是什么？」。完整开放问答需要在本地版配置自己的服务。', citations: [] };
  const intro = persona === 'skill:feynman' ? '换个直观讲法：把新复习方法看作你主动改变的条件，把测验成绩看作观察结果。\n\n' : '';
  return { text: `> 公开示例 · 以下为预先编写的讲解。\n\n${intro}${chosen.text}\n\n**再想一步：**需要哪些比较条件，才能排除其他解释？`, citations: [{ date: lesson.date, leti: lesson.number, time: `${Math.floor(chosen.at / 60).toString().padStart(2, '0')}:${(chosen.at % 60).toString().padStart(2, '0')}`, quote: chosen.text, speaker: '老师' }] };
}
function discussion(id) {
  const comments = state.comments[id] || [];
  return { ok: true, comments, total: comments.length, userCount: comments.filter(c => c.kind === 'user').length, configured: false, contextHash: 'public-example', mode: 'preset' };
}
const schedule = () => ({ ok: true, slots: [], periods: [], semester: { firstWeekMonday: '2026-09-01', totalWeeks: 18 } });
function feedList(filter) {
  let posts = state.posts;
  if (filter === 'saved') posts = posts.filter(p => p.saved);
  if (filter === 'unclear') posts = posts.filter(p => p.feedback === 'confused' || p.origin === 'unclear');
  if (filter === 'important') posts = posts.filter(p => p.origin === 'important');
  return { ok: true, posts, total: posts.length, counts: { recommend: state.posts.length, unclear: 0, important: 0, qa: state.posts.length, saved: state.posts.filter(p => p.saved).length }, covers: { available: true }, nextOffset: null };
}

export function installPublicDemo() {
  if (window.__synkorePublicDemo) return;
  window.__synkorePublicDemo = true; state = read();
  const original = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.origin), p = url.pathname;
    if (url.origin !== location.origin || (!p.startsWith('/api/') && !p.startsWith('/demo-replay/'))) return original(input, init);
    if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    let b = {}; try { b = JSON.parse(init.body || '{}'); } catch {}
    const method = init.method || 'GET', suffix = p.slice('/api'.length);
    if (p.startsWith('/demo-replay/')) {
      const s = p.slice('/demo-replay'.length);
      if (s === '/demo') return json({ ...replay, mediaReady: true });
      if (s === '/media') return original('/demo-assets/research-methods-5min.mp4', init);
      if (s.startsWith('/preview/')) return original(`/demo-assets/cards/${s.split('/').pop().replace('.png', '')}-${url.searchParams.get('playing') === 'true'}.png`, init);
      if (s === '/marks') { if (method === 'POST') { state.replayMarks.push(b); save(); return json({ mark: b }); } return json({ marks: state.replayMarks }); }
      if (s === '/board') return json({ connected: false, owned: false, ports: [] });
      if (s === '/health') return json({ ok: true, mode: 'prepared-replay', mediaReady: true });
      return json({ error: '公开演示提供屏幕预览，USB 开发板连接在本地版使用。' }, 400);
    }
    if (suffix === '/health') return json({ ok: true, mode: 'public-demo' });
    if (suffix === '/settings') return json({ termName: '公开示例', voiceEnabled: false });
    if (suffix === '/personas') return json({ personas });
    if (suffix === '/voices/status') return json({ enabled: false, hasKey: false, teachers: [] });
    if (suffix === '/lectures') return json({ lectures });
    if (/^\/lectures\/\d+$/.test(suffix)) return json({ lecture: lectures.find(l => l.cour_id === Number(suffix.split('/').pop())) || lectures[1] });
    if (suffix === '/qa/scopes') return json({ teachers: [{ teacher }], lectures, stats: { teachers: 1, lectures: 2, ready: 2, totalWan: .1 } });
    if (suffix === '/qa/call-plan') return json({ configured: true, model: '预设演示', calls: 0 });
    if (suffix === '/qa/sessions') return json({ sessions: state.sessions.map(s => ({ ...s, messages: undefined, message_count: s.messages.length })) });
    if (/^\/qa\/sessions\/\d+$/.test(suffix)) {
      const id = Number(suffix.split('/').pop()), s = state.sessions.find(s => s.id === id);
      if (method === 'DELETE') { state.sessions = state.sessions.filter(s => s.id !== id); save(); return json({ ok: true }); }
      if (method === 'PATCH' && s) { s.pinned = b.pinned; save(); }
      return json({ session: s, messages: s?.messages || [] });
    }
    if (suffix === '/qa/lecture/stream') {
      const result = answer(b.question || '', b.sourceScope?.courIds?.[0], b.personaId);
      let session = state.sessions.find(s => s.id === Number(b.sessionId));
      if (!session) { session = { id: Date.now(), title: b.question.slice(0, 24), teacher, subj_name: subject, updated_at: new Date().toISOString(), messages: [] }; state.sessions.unshift(session); }
      const evidence = { teacher, subjName: subject, personaId: b.personaId, personaName: personas.find(p => p.id === b.personaId)?.name || '学习助手', citations: result.citations };
      session.messages.push({ role: 'user', text: b.question, scope: b.sourceScope }, { role: 'assistant', text: result.text, ...evidence }); save();
      return stream(responseEvents(result.text, evidence, session.id));
    }
    if (suffix === '/restyle/scopes') return json({ courses: [{ subject, teacher, lectures: 2 }], teachers: [], personas });
    if (suffix === '/restyle/lectures') return json({ lectures: lectures.map(l => ({ ...l, chars: l.transcript_chars })) });
    if (suffix === '/restyle/cached') return json({ cached: true, markdown: restyled });
    if (suffix === '/restyle/stream') return stream([['delta', { text: restyled }], ['done', { full: restyled, markdown: restyled, ok: true }]]);
    if (suffix === '/restyle/batch/status') return json({ running: false });
    if (suffix === '/listening/schedule') return json(schedule());
    if (suffix === '/learning-feed/timeline') return json({ replays: [{ key: 'public-sample', courId: 900002, title: subject, date: '2026-10-02', startAt: Date.parse('2026-10-02T09:00:00+08:00'), endAt: Date.parse('2026-10-02T09:05:00+08:00') }] });
    if (suffix === '/learning-feed/marks') {
      if (method === 'POST') { const mark = { ...b, offsetMs: Math.max(0, b.at - Date.parse('2026-10-02T09:00:00+08:00')) }; state.marks.push(mark); save(); return json({ ok: true, mark }); }
      return json({ marks: state.marks });
    }
    if (suffix === '/learning-feed/' || suffix === '/learning-feed') return json(feedList(url.searchParams.get('filter')));
    if (suffix === '/learning-feed/preferences') {
      if (method === 'POST') { state.preferences = { ...state.preferences, ...b }; save(); }
      return json({ preferences: { ...state.preferences, catalog: ['王者荣耀', '诺兰的电影', '周杰伦'].map(label => ({ label, kind: 'interest' })), formats: [{ id: 'analysis', label: '换个角度解读' }, { id: 'poem', label: '把它写成诗' }] } });
    }
    if (suffix.startsWith('/learning-feed/learning-profile')) return json({ profile: { enabled: false, values: [], evidence: [], confidence: '演示数据仅保存在当前浏览器', stats: { opens: 0, effectiveReads: 0, comments: Object.values(state.comments).flat().filter(c => c.kind === 'user').length } } });
    if (suffix === '/learning-feed/writers') return json({ writers: [] });
    if (suffix === '/learning-feed/signals') return json({ ok: true });
    const pm = /^\/learning-feed\/posts\/([^/]+)(.*)$/.exec(suffix);
    if (pm) {
      const post = state.posts.find(p => p.id === decodeURIComponent(pm[1])); if (!post) return json({ error: '示例文章不存在' }, 404);
      const action = pm[2];
      if (!action) return json({ post });
      if (action === '/signals') return json({ ok: true });
      if (action === '/feedback' || action === '/preference') { Object.assign(post, b); if (b.status !== undefined) post.feedback = b.status; if (b.preference !== undefined) post.personalPreference = b.preference; save(); return json({ post }); }
      if (action === '/comments/plan') return json({ calls: 0, contextHash: 'public-example' });
      if (action === '/comments') {
        if (method === 'POST') {
          state.comments[post.id] ||= [];
          state.comments[post.id].push({ id: b.id || crypto.randomUUID(), parentId: b.parentId, kind: 'user', name: '我', text: String(b.text || '').slice(0, 2000), createdAt: new Date().toISOString() });
          if (b.replyMode === 'auto') state.comments[post.id].push({ id: crypto.randomUUID(), parentId: b.id, kind: 'seed', name: '小幽灵', provider: 'preset', role: 'coach', text: '预设思考提示：找出材料中的一个条件，再想一个能检验它的反例。', createdAt: new Date().toISOString() });
          post.discussionCount = state.comments[post.id].length; save();
        }
        return json(discussion(post.id));
      }
      if (action === '/presentation' || action === '/context') { if (b.interest) post.interest = b.interest; if (b.format) post.format = b.format; save(); return json({ post }); }
      if (action === '/write-plan') return json({ error: '公开版使用预设文章。在线生成与联网搜索请使用本地版。' }, 400);
    }
    return json({ error: '该功能需本地版配置。公开版可体验示例问答、信息流、标记和五分钟伴学。' }, 400);
  };
}
