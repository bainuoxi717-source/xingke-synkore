import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Send, Image as ImageIcon, Quote, Volume2, Square, Users, BookOpen, ChevronDown, Plus, Trash2, MessageSquare, Pin, History } from 'lucide-react';
import { api } from '../api.js';
import { pptSrc } from '../utils.js';
import Markdown from '../components/Markdown.jsx';
import Chart from '../components/Chart.jsx';
import { AttachmentPicker, AttachmentList } from '../components/Attachments.jsx';
import { attachmentIdsFrom, savedAttachment } from '../utils/attachmentRefs.js';
import PersonaSelect from '../components/PersonaSelect.jsx';
import { migrateAssistantDraft } from '../utils/qaDrafts.js';
import { displayTeacher, redactShowcaseText } from '../utils/showcasePrivacy.js';
import useVoiceReadout from '../hooks/useVoiceReadout.js';
import VoiceSelect from '../components/VoiceSelect.jsx';

const ATTACHMENT_DRAFT_KEY = 'personal-agent:qa-attachment-draft';
const PERSONA_DRAFT_KEY = 'personal-agent:qa-persona-draft';
const TEXT_DRAFT_KEY = 'personal-agent:qa-text-draft';
const LECTURE_DRAFT_KEY = 'personal-agent:qa-lecture-draft';
function initialLecture(search) {
  try {
    const params = new URLSearchParams(search), value = params.has('courId') ? params.get('courId') : sessionStorage.getItem(LECTURE_DRAFT_KEY);
    return /^[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value)) ? String(value) : '';
  } catch { return ''; }
}
function initialAttachments(search) {
  const params = new URLSearchParams(search);
  if (params.has('attachments')) return attachmentIdsFrom(params.get('attachments')).map(savedAttachment);
  try { return attachmentIdsFrom(JSON.parse(sessionStorage.getItem(ATTACHMENT_DRAFT_KEY) || '[]')).map(savedAttachment); }
  catch { return []; }
}

const EXAMPLES = [
  '自我披露是什么？老师怎么讲的',
  '老师强调过哪些重点',
  '帮我用他的语气讲讲这章的核心',
  '这块内容老师举了什么例子',
];

function SlideGallery({ slides, onZoom, redact = (value) => value }) {
  if (!slides?.length) return null;
  return (
    <div className="slide-gallery">
      <div className="slide-row">
        {slides.map((s) => (
          <figure key={s.url} className="slide-card" onClick={() => onZoom?.(s)}>
            <img src={pptSrc(s.url)} alt={redact(s.idx)} loading="lazy" />
            <figcaption>
              <b>{redact(s.idx)}</b> {s.date} 第{s.leti}节
              {s.comment && <div className="slide-comment">{redact(s.comment)}</div>}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
function Citations({ list, redact = (value) => value }) {
  if (!list?.length) return null;
  return (
    <details className="citation-box">
      <summary><Quote size={13} /> 📌 出处（{list.length} 条课堂记录）</summary>
      <div className="citation-list">
        {list.map((c, i) => (
          <div key={i} className="citation-item">
            <span className="chip accent">[{c.n ?? i + 1}]</span>
            <span className={`chip ${c.speaker === '同学' ? 'warn' : c.speaker === '未识别' ? 'gray' : 'ok'}`}>
              {c.speaker === '同学' ? '🙋 同学' : c.speaker === '未识别' ? '❓ 未识别' : '👨‍🏫 老师'}
            </span>
            <span className="chip gray">{c.date} 第{c.leti}节 {c.time}</span>
            <div className="citation-quote">“{redact(c.quote)}”</div>
          </div>
        ))}
      </div>
    </details>
  );
}

export default function QA() {
  const location = useLocation();
  const navigate = useNavigate();
  const [msgs, setMsgs] = useState([{
    role: 'assistant',
    welcome: true,
    text: '正在读取课堂数据…',
  }]);
  const [input, setInput] = useState(() => { try { migrateAssistantDraft(sessionStorage); return sessionStorage.getItem(TEXT_DRAFT_KEY) || ''; } catch { return ''; } });
  useEffect(() => { try { if (input) sessionStorage.setItem(TEXT_DRAFT_KEY, input); else sessionStorage.removeItem(TEXT_DRAFT_KEY); } catch {} }, [input]);
  const [attachments, setAttachments] = useState(() => initialAttachments(location.search));
  const attachmentsPending = attachments.some((attachment) => attachment.status !== 'ready');
  const inputRef = useRef('');
  const consumedSearchRef = useRef(null);
  const [entryNotice, setEntryNotice] = useState('');
  const [scopeError, setScopeError] = useState('');
  const [scopeLoading, setScopeLoading] = useState(true);
  const [scopeAttempt, setScopeAttempt] = useState(0);
  const [sessionError, setSessionError] = useState('');
  const [busy, setBusy] = useState(false);
  const sendingRef = useRef(false);
  const [scopes, setScopes] = useState(null);
  const [stats, setStats] = useState(null);
  const [teacher, setTeacher] = useState('');
  const [lectureId, setLectureId] = useState(() => initialLecture(location.search));
  const pickedLecture = scopes?.lectures?.find((item) => String(item.cour_id) === lectureId);
  const noteAttachments = attachments.filter((item) => item.kind === 'lecture-note');
  const restyleLectureId = attachments.length ? (noteAttachments.length === 1 ? String(noteAttachments[0].courId || '') : '') : lectureId;
  useEffect(() => { try { if (lectureId) sessionStorage.setItem(LECTURE_DRAFT_KEY, lectureId); else sessionStorage.removeItem(LECTURE_DRAFT_KEY); } catch {} }, [lectureId]);
  const [personaId, setPersonaId] = useState(() => {
    const params = new URLSearchParams(location.search);
    if (params.has('personaId')) return params.get('personaId') || '';
    try { return sessionStorage.getItem(PERSONA_DRAFT_KEY) || ''; } catch { return ''; }
  });
  const sessionReturnRef = useRef((() => {
    const params = new URLSearchParams(location.search);
    return { id: Number(params.get('sessionId')), personaId: params.has('personaId') ? params.get('personaId') || '' : null,
      lectureId: params.get('keepDraft') === '1' ? initialLecture(location.search) : null,
      attachments: params.get('keepDraft') === '1' ? initialAttachments(location.search) : null };
  })());
  useEffect(() => { try { sessionStorage.setItem(PERSONA_DRAFT_KEY, personaId); } catch {} }, [personaId]);
  const [mode, setMode] = useState('teacher');
  const readout = useVoiceReadout();
  const speaking = readout.active;
  const [zoom, setZoom] = useState(null);      // 全局 PPT 灯箱
  const bottomRef = useRef(null);
  inputRef.current = input;

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (!params.has('q') && !params.has('attachments') && !params.has('personaId') && !params.has('courId')) {
      consumedSearchRef.current = null;
      return;
    }
    if (consumedSearchRef.current === location.search) return;
    consumedSearchRef.current = location.search;
    const question = params.get('q')?.trim();
    if (question) {
      // 首页入口只准备问题；用户仍需手动发送，不自动触发 AI 请求。
      if (!inputRef.current.trim()) {
        setInput(question);
        setEntryNotice('问题和资料已准备好，选择讲解方式后发送即可');
      } else {
        setEntryNotice('已保留你正在编辑的问题，首页的问题没有覆盖当前草稿。');
      }
    }
    if (params.has('attachments')) {
      const ids = attachmentIdsFrom(params.get('attachments'));
      setAttachments((current) => [...current, ...ids.filter((id) => !current.some((item) => String(item.id) === id)).map(savedAttachment)]);
    }
    params.delete('q');
    params.delete('attachments');
    if (params.has('personaId')) setPersonaId(params.get('personaId') || '');
    if (params.has('courId')) { setLectureId(initialLecture(location.search)); setTeacher(''); }
    params.delete('personaId');
    params.delete('courId');
    params.delete('keepDraft');
    const remainingSearch = params.toString();
    navigate({ pathname: location.pathname, search: remainingSearch ? `?${remainingSearch}` : '', hash: location.hash }, { replace: true });
  }, [location.search, location.pathname, location.hash, navigate]);

  useEffect(() => {
    const ids = attachmentIdsFrom(attachments.map((item) => item.id));
    try {
      if (ids.length) sessionStorage.setItem(ATTACHMENT_DRAFT_KEY, JSON.stringify(ids));
      else sessionStorage.removeItem(ATTACHMENT_DRAFT_KEY);
    } catch { /* 浏览器禁用存储时仍可在当前页面使用附件。 */ }
  }, [attachments]);

  useEffect(() => {
    let active = true;
    let timeout;
    setScopeLoading(true);
    setScopeError('');
    const request = Promise.all([api.get('/qa/scopes'), api.get('/lectures').catch(() => null)])
      .then(([result, catalog]) => ({ ...result, lectures: catalog?.lectures || result.lectures || [] }));
    const deadline = new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('读取超时')), 12000);
    });
    Promise.race([request, deadline]).then((r) => {
      if (!active) return;
      setScopes(r);
      if (r?.stats) {
        setStats(r.stats);
        // 欢迎语用实时数据（避免写死的数字越用越不准）
        setMsgs((m) => m.map((x, i) => (i === 0 && x.welcome) ? {
          ...x,
          text: `你的学习资料已就绪：**${r.stats.ready} 节课堂**，约 **${r.stats.totalWan} 万字**。\n\n从「添加文件」选择本地文件、课件或某节课的课程笔记，再选择你想听的讲解方式。\n\n同一份材料可以换不同人物来讲；课堂内容与原老师的出处会保留。`,
        } : x));
      } else {
        setMsgs((m) => m.map((x) => x.welcome ? { ...x, text: '你好，我是你的学习助手。选择一位老师，或直接输入你想了解的课堂问题。' } : x));
      }
    }).catch(() => {
      if (!active) return;
      setScopeError('暂时无法读取课堂数据。请确认本地服务已启动，或前往设置检查数据导入。');
      setMsgs((m) => m.map((x) => x.welcome ? { ...x, text: '课堂数据暂时没有连接成功。你的问题可以先保留在下方，连接恢复后再发送。' } : x));
    }).finally(() => {
      clearTimeout(timeout);
      if (active) setScopeLoading(false);
    });
    return () => { active = false; clearTimeout(timeout); };
  }, [scopeAttempt]);
  useEffect(() => {
    if (!msgs.some((message) => message.role === 'user' || message.streaming)) return;
    // 只滚动消息列表，欢迎语加载不会把手机页面或外层工作区滚走。
    const messagesElement = bottomRef.current?.parentElement;
    messagesElement?.scrollTo({ top: messagesElement.scrollHeight, behavior: 'smooth' });
  }, [msgs]);

  // 流式问答：证据先到（PPT/引用瞬间可见），答案边生成边读
  const send = async (text) => {
    const q = (text ?? input).trim();
    if (!q || busy || sendingRef.current || attachmentsPending) return;
    sendingRef.current = true;
    try {
      await api.get('/qa/call-plan');
    } catch (e) { setEntryNotice('无法核对本次调用：' + e.message); sendingRef.current = false; return; }
    setEntryNotice('');
    if (roundtable && peers.length >= 2) return sendRoundtable(q);
    const sentAttachments = attachments.filter((item) => item.status === 'ready' && item.id);
    const attachmentIds = attachmentIdsFrom(sentAttachments.map((item) => item.id));
    setMsgs((m) => [...m, { role: 'user', text: q, attachments: sentAttachments }]);
    setInput('');
    setBusy(true);
    setFirstTokenMs(null);

    const scope = lectureId ? { courIds: [Number(lectureId)], ...(pickedLecture?.teacher ? { teacher: pickedLecture.teacher } : {}) } : teacher ? { teacher } : {};
    // 用稳定 mid 定位这条消息（不能用对象身份 —— patch 会产生新对象导致失配）
    const mid = 'm' + Date.now() + Math.random().toString(36).slice(2, 7);
    const target = { mid, role: 'assistant', streaming: true, text: '', slides: [], citations: [], evidence: [] };
    setMsgs((m) => [...m, target]);

    const patch = (fn) => setMsgs((m) => m.map((x) => (x.mid === mid ? fn(x) : x)));

    let buf = '';
    let streamFailed = false;
    let completed = false;
    let lastFlush = 0;
    // 注意：不能依赖 setTimeout 节流 —— 密集的 await read() 会饿死定时器，导致文字在结束时才一次性出现
    const flushNow = () => { lastFlush = Date.now(); patch((x) => ({ ...x, text: buf })); };

    try {
      const res = await fetch('/api/qa/lecture/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, sourceScope: scope, mode, personaId, sessionId, attachmentIds, approved: true }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let raw = '';
      const t0 = Date.now();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += dec.decode(value, { stream: true });
        const parts = raw.split('\n\n');
        raw = parts.pop() ?? '';
        for (const p of parts) {
          const ev = /^event: (\w+)/m.exec(p)?.[1];
          const dm = /^data: (.*)$/m.exec(p);
          if (!ev || !dm) continue;
          let data; try { data = JSON.parse(dm[1]); } catch { continue; }

          if (ev === 'evidence') {
            patch((x) => ({ ...x, teacher: data.teacher, subjName: data.subjName, mode: data.mode,
              personaName: data.personaName, personaId: data.personaId, sources: data.sources,
              slides: data.slides ?? [], citations: data.citations ?? [], evidence: data.evidence ?? [] }));
          } else if (ev === 'delta') {
            if (!buf) setFirstTokenMs(Date.now() - t0);
            buf += data.text;
            if (Date.now() - lastFlush > 80) flushNow();   // 同步按时间节流（不依赖定时器）
          } else if (ev === 'done') {
            completed = true;
            buf = data.full || buf;
            const cm = buf.match(/```chart\s*([\s\S]*?)```/);
            let chart = null; let clean = buf;
            if (cm) { try { chart = JSON.parse(cm[1]); } catch { chart = null; } clean = buf.replace(cm[0], '').trim(); }
            patch((x) => ({ ...x, text: clean, streaming: false, sessionId: data.sessionId,
              slides: data.slides?.length ? data.slides : x.slides,
              citations: data.citations?.length ? data.citations : x.citations,
              evidence: data.evidence?.length ? data.evidence : x.evidence,
              chart, coverage: data.coverage || 'partial' }));
            if (data.sessionId) { setSessionId(data.sessionId); loadSessions(); }
          } else if (ev === 'error') {
            streamFailed = true;
            patch((x) => ({ ...x, text: buf + '\n\n⚠️ ' + data.message, streaming: false }));
          }
        }
      }
      if (!completed && !streamFailed) patch((x) => ({ ...x, text: buf + '\n\n回答连接已中断，请重试。', streaming: false }));
    } catch (e) {
      patch((x) => ({ ...x, text: `⚠️ 出错了：${e.message}`, streaming: false }));
    } finally { setBusy(false); sendingRef.current = false; }
  };

  // ── 老师圆桌：多师并答 / 互相回应 / 跨学科融合 ──
  const sendRoundtable = async (text) => {
    const q = (text ?? input).trim();
    if (!q || busy || peers.length < 2 || attachmentsPending) return;
    const sentAttachments = attachments.filter((item) => item.status === 'ready' && item.id);
    const attachmentIds = attachmentIdsFrom(sentAttachments.map((item) => item.id));
    setMsgs((m) => [...m, { role: 'user', text: q, attachments: sentAttachments }]);
    setInput('');
    setBusy(true);

    const mid = 'rt' + Date.now() + Math.random().toString(36).slice(2, 7);
    const target = { mid, role: 'assistant', roundtable: true, streaming: true, panels: [], synthesis: '' };
    setMsgs((m) => [...m, target]);
    const patch = (fn) => setMsgs((m) => m.map((x) => (x.mid === mid ? fn(x) : x)));
    const patchPanel = (t, fn) => patch((x) => ({
      ...x, panels: x.panels.some((p) => p.teacher === t)
        ? x.panels.map((p) => (p.teacher === t ? fn(p) : p))
        : [...x.panels, fn({ teacher: t, subjName: '', answer: '', respond: '', citations: [], slides: [], evidence: [] })],
    }));

    try {
      const res = await fetch('/api/qa/roundtable/stream', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, teachers: peers, debate, synthesize: synth, sessionId, attachmentIds }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let raw = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += dec.decode(value, { stream: true });
        const parts = raw.split('\n\n');
        raw = parts.pop() ?? '';
        for (const p of parts) {
          const ev = /^event: (\w+)/m.exec(p)?.[1];
          const dm = /^data: (.*)$/m.exec(p);
          if (!ev || !dm) continue;
          let data; try { data = JSON.parse(dm[1]); } catch { continue; }
          if (ev === 'teacher_begin') {
            patchPanel(data.teacher, (p) => ({ ...p, subjName: data.subjName ?? p.subjName,
              citations: data.citations ?? p.citations, slides: data.slides ?? p.slides, evidence: data.evidence ?? p.evidence,
              [data.phase === 'respond' ? 'respond' : 'answer']: p[data.phase === 'respond' ? 'respond' : 'answer'] ?? '' }));
          } else if (ev === 'delta' && data.teacher) {
            const key = data.phase === 'respond' ? 'respond' : 'answer';
            patchPanel(data.teacher, (p) => ({ ...p, [key]: (p[key] ?? '') + data.text }));
          } else if (ev === 'synthesis_delta') {
            patch((x) => ({ ...x, synthesis: (x.synthesis ?? '') + data.text }));
          } else if (ev === 'done') {
            setAttachments((current) => current.filter((item) => !attachmentIds.includes(String(item.id))));
            patch((x) => ({ ...x, streaming: false, sessionId: data.sessionId }));
            if (data.sessionId) { setSessionId(data.sessionId); loadSessions(); }
          } else if (ev === 'error') {
            patch((x) => ({ ...x, streaming: false, error: data.message }));
          }
        }
      }
      patch((x) => ({ ...x, streaming: false }));
    } catch (e) {
      patch((x) => ({ ...x, streaming: false, error: e.message }));
    } finally { setBusy(false); }
  };

  // ── 对话存档 ──
  const [sessions, setSessions] = useState([]);
  const [sessionId, setSessionId] = useState(0);
  const [histOpen, setHistOpen] = useState(true);
  const [firstTokenMs, setFirstTokenMs] = useState(null);
  // 老师圆桌
  const [roundtable, setRoundtable] = useState(false);
  const [peers, setPeers] = useState([]);
  const [debate, setDebate] = useState(true);
  const [synth, setSynth] = useState(true);

  const loadSessions = () => api.get('/qa/sessions').then((r) => setSessions(r.sessions ?? [])).catch(() => {});

  const openSession = async (id) => {
    setSessionError('');
    try {
      const d = await api.get('/qa/sessions/' + id);
      setSessionId(id);
      setMsgs(d.messages.map((m) => ({ role: m.role, ...m })));
      const lastUser = [...d.messages].reverse().find((m) => m.role === 'user');
      const lastAssistant = [...d.messages].reverse().find((m) => m.role === 'assistant');
      const returned = sessionReturnRef.current?.id === id ? sessionReturnRef.current : null;
      const savedScope = lastUser?.scope?.courIds;
      const restoredLecture = returned?.lectureId ?? (savedScope?.length === 1 ? String(savedScope[0]) : '');
      setLectureId(restoredLecture);
      setTeacher(restoredLecture ? '' : d.session?.teacher || '');
      setAttachments(returned?.attachments ?? attachmentIdsFrom((lastUser?.attachments || []).map((item) => item.id)).map(savedAttachment));
      setPersonaId(returned?.personaId ?? lastAssistant?.personaId ?? '');
      if (returned) sessionReturnRef.current = null;
      if (d.session?.mode) setMode(d.session.mode);
    } catch (e) { setSessionError('打开会话失败，请稍后重试：' + e.message); }
  };

  const newSession = () => {
    setSessionError('');
    setAttachments([]);
    setSessionId(0);
    setMsgs([{ role: 'assistant', text: '新对话已开始 ✨\n\n选好「问答范围」再提问，内容会**自动存档**，以后随时能翻回来。' }]);
  };

  const delSession = async (id, e) => {
    e.stopPropagation();
    if (!confirm('删除这个对话？此操作不可恢复。')) return;
    await api.del('/qa/sessions/' + id).catch(() => {});
    if (id === sessionId) newSession();
    loadSessions();
  };

  const pinSession = async (s, e) => {
    e.stopPropagation();
    await api.patch('/qa/sessions/' + s.id, { pinned: s.pinned ? 0 : 1 }).catch(() => {});
    loadSessions();
  };

  useEffect(() => { loadSessions(); }, []);
  const requestedSession = new URLSearchParams(location.search).get('sessionId');
  useEffect(() => {
    const id = Number(requestedSession);
    if (Number.isSafeInteger(id) && id > 0) openSession(id);
  }, [requestedSession]);
  const speak = (text, index) => readout.read(text, index);

  const fmtDay = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const diff = (Date.now() - d.getTime()) / 86400000;
    if (diff < 1) return '今天';
    if (diff < 2) return '昨天';
    if (diff < 30) return Math.round(diff) + ' 天前';
    return d.toLocaleDateString('zh-CN');
  };

  const teacherNames = [...new Set([
    ...(scopes?.teachers || []).map((item) => item.teacher), ...sessions.map((item) => item.teacher),
    ...msgs.flatMap((item) => [item.teacher, item.personaId?.startsWith('teacher:') ? item.personaName : '', ...(item.panels || []).map((panel) => panel.teacher)]),
  ].filter(Boolean))];
  const privateText = (value) => redactShowcaseText(value, teacherNames);
  const privateCitations = (items) => (items || []).map((item) => ({ ...item, quote: privateText(item.quote) }));
  const privateSlides = (items) => (items || []).map((item) => ({ ...item, idx: privateText(item.idx), comment: privateText(item.comment) }));
  const lectureGroups = new Map();
  for (const lecture of scopes?.lectures || []) {
    const key = `${lecture.subj_name}\n${lecture.teacher}`;
    if (!lectureGroups.has(key)) lectureGroups.set(key, { subject: lecture.subj_name, teacher: lecture.teacher, items: [] });
    lectureGroups.get(key).items.push(lecture);
  }
  const lectureLabel = (item) => `${privateText(item.subj_name)} · ${String(item.begin_time || '').slice(0, 16).replace('T', ' ')} · 第${item.leti_number || '?'}节`;

  return (
    <div className="qa-layout">
      {/* 左侧：对话存档 */}
      <aside className={`qa-hist${histOpen ? '' : ' folded'}`}>
        <div className="qa-hist-head">
          <button className="btn primary" style={{ flex: 1 }} onClick={newSession}>
            <Plus size={15} /> 新对话
          </button>
          <button className="btn ghost" title="收起/展开" onClick={() => setHistOpen(!histOpen)}>
            <History size={15} />
          </button>
        </div>
        <div className="qa-hist-list">
          {sessions.length === 0 && (
            <div className="qa-hist-empty"><MessageSquare size={20} /><div>还没有存档的对话</div><div style={{ fontSize: 11 }}>提问后会自动保存</div></div>
          )}
          {sessions.map((s) => (
            <div key={s.id} className={`qa-hist-item${s.id === sessionId ? ' active' : ''}`} onClick={() => openSession(s.id)}>
              <div className="qa-hist-title">{privateText(s.title || '未命名对话')}</div>
              <div className="qa-hist-meta">
                <span>{s.teacher ? displayTeacher(s.teacher) : '全部'}</span>
                <span>·</span>
                <span>{s.message_count} 条</span>
                <span>·</span>
                <span>{fmtDay(s.updated_at)}</span>
              </div>
              <div className="qa-hist-ops">
                <button title={s.pinned ? '取消置顶' : '置顶'} className={s.pinned ? 'on' : ''} onClick={(e) => pinSession(s, e)}><Pin size={12} /></button>
                <button title="删除" onClick={(e) => delSession(s.id, e)}><Trash2 size={12} /></button>
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* 右侧：对话主体 */}
      <div className="qa-main">
      <div className="page-head" style={{ flexShrink: 0 }}>
        <div>
          <div className="page-title">学习问答</div>
          <div className="page-sub">先选学习资料，再选讲解方式 · 保留课堂出处</div>
        </div>
      </div>

      {entryNotice && <div className="section-note" role="status" style={{ flexShrink: 0 }}>{privateText(entryNotice)}</div>}
      {scopeLoading && scopeAttempt > 0 && <div className="section-note" role="status" style={{ flexShrink: 0 }}>正在重新读取课堂数据…</div>}
      {scopeError && (
        <div className="section-note" role="alert" style={{ flexShrink: 0 }}>
          <p>{scopeError}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            <button className="btn sm" onClick={() => setScopeAttempt((n) => n + 1)} disabled={scopeLoading}>{scopeLoading ? '正在重试…' : '重新读取'}</button>
            <Link className="btn sm" to="/settings">前往设置</Link>
          </div>
        </div>
      )}
      {sessionError && <div className="section-note" role="alert" style={{ flexShrink: 0 }}>{privateText(sessionError)}</div>}

      <div className="qa-scope">
        <span className="qa-scope-label"><BookOpen size={14} /> 课堂来源</span>
        <div className="qa-select-wrap">
          <select aria-label="选择课堂课次" value={noteAttachments.length === 1 ? String(noteAttachments[0].courId || '') : lectureId} onChange={(e) => { setLectureId(e.target.value); setTeacher(''); }} disabled={attachments.length > 0 || scopeLoading || busy} title={pickedLecture ? lectureLabel(pickedLecture) : '选择具体课次后可换个讲法'}>
            <option value="">{teacher ? `${displayTeacher(teacher)} · 请选择具体课次` : '全部课程 · 选择具体课次'}</option>
            {[...lectureGroups].map(([key, group]) => <optgroup key={key} label={`${privateText(group.subject)} · ${displayTeacher(group.teacher)}`}>
              {group.items.map((item) => <option key={item.cour_id} value={String(item.cour_id)} disabled={Number(item.transcript_chars ?? item.chars ?? 0) < 50}>{lectureLabel(item)}{Number(item.transcript_chars ?? item.chars ?? 0) < 50 ? ' · 暂无字幕' : ''}</option>)}
            </optgroup>)}
          </select>
          <ChevronDown size={14} className="qa-select-arrow" />
        </div>
        <PersonaSelect value={personaId} onChange={setPersonaId} disabled={busy} onCustom={() => {
          const back = new URLSearchParams(location.search); if (sessionId) back.set('sessionId', String(sessionId));
          if (lectureId) back.set('courId', lectureId);
          back.set('keepDraft', '1'); back.set('personaId', personaId);
          navigate(`/personas/custom?${new URLSearchParams({ returnTo: `/qa${back.size ? '?' + back : ''}` })}`);
        }} />
        <button type="button" className="btn sm" disabled={!restyleLectureId || busy || (!attachments.length && !pickedLecture)} title={restyleLectureId ? '用所选讲解方式重讲这一节课' : '先选择一节课'} onClick={() => {
          navigate(`/restyle?${new URLSearchParams({ courId: restyleLectureId, personaId })}`);
        }}>换个讲法</button>
        <VoiceSelect readout={readout} />
        <div className="qa-mode" style={{ display: 'none' }}>
          <button className={mode === 'teacher' ? 'chip accent' : 'chip gray'} onClick={() => setMode('teacher')} style={{ cursor: 'pointer', border: 'none' }}>
            老师口吻
          </button>
          <button className={mode === 'assistant' ? 'chip accent' : 'chip gray'} onClick={() => setMode('assistant')} style={{ cursor: 'pointer', border: 'none' }}>
            助手讲解
          </button>
        </div>
        <button hidden
          className={roundtable ? 'chip accent' : 'chip gray'}
          style={{ display: 'none' }}
          onClick={() => setRoundtable(!roundtable)}
          title="多位老师同时参与：各自并答 → 互相回应 → 跨学科融合"
        >
          👥 老师圆桌{roundtable && peers.length >= 2 ? ` (${peers.length})` : ''}
        </button>
      </div>

      {/* 圆桌模式：选老师 + 选项 */}
      {roundtable && (
        <div className="rt-bar">
          <div className="rt-teachers">
            <span className="rt-label">选老师（2-5 位，跨学科更有意思）</span>
            {(scopes?.teachers ?? []).map((t) => {
              const on = peers.includes(t.teacher);
              return (
                <button
                  key={t.teacher}
                  className={`rt-chip${on ? ' on' : ''}`}
                  onClick={() => setPeers((p) => (on ? p.filter((x) => x !== t.teacher) : p.length >= 5 ? p : [...p, t.teacher]))}
                >
                  {displayTeacher(t.teacher)}
                  <span className="rt-chip-sub">{privateText(t.courses.split(',')[0])}</span>
                </button>
              );
            })}
          </div>
          <div className="rt-opts">
            <label><input type="checkbox" checked={debate} onChange={(e) => setDebate(e.target.checked)} /> 第二轮：老师互相回应</label>
            <label><input type="checkbox" checked={synth} onChange={(e) => setSynth(e.target.checked)} /> 融合成一份完整讲解</label>
            {peers.length < 2 && <span className="rt-warn">至少选 2 位老师</span>}
          </div>
        </div>
      )}

      <div className="qa-msgs">
        {msgs.map((m, i) => (
          <div key={i} className={`qa-msg ${m.role}`}>
            {m.roundtable ? (
              <div className="rt-answer">
                <div className="rt-head">
                  <span className="chip accent">👥 老师圆桌 · {m.panels.length} 位</span>
                  {m.streaming && <span className="chip warn">讨论中…</span>}
                  {m.error && <span className="chip danger">⚠️ {privateText(m.error)}</span>}
                </div>
                {m.panels.filter((p) => p.answer || p.respond).map((p) => (
                  <div className="rt-panel" key={p.teacher}>
                    <div className="rt-panel-head">
                      <span className="rt-avatar">👨‍🏫</span>
                      <b>{displayTeacher(p.teacher)}</b>
                      {p.subjName && <span className="chip gray">{privateText(p.subjName)}</span>}
                    </div>
                    <Markdown text={privateText(p.answer)} slides={privateSlides(p.slides)} />
                    {p.respond && (
                      <div className="rt-respond">
                        <div className="rt-respond-label">🔄 回应其他老师</div>
                        <Markdown text={privateText(p.respond)} slides={[]} />
                      </div>
                    )}
                    <Citations list={p.citations} redact={privateText} />
                  </div>
                ))}
                {m.panels.length === 0 && m.streaming && <div className="qa-stream-hint">🎙 多位老师正在准备…</div>}
                {m.synthesis && (
                  <div className="rt-synth">
                    <div className="rt-synth-head">🧩 跨学科融合</div>
                    <Markdown text={privateText(m.synthesis)} slides={[]} />
                  </div>
                )}
                {m.streaming && m.synthesis && <div className="qa-stream-hint">融合总结生成中…</div>}
              </div>
            ) : m.role === 'user' ? (
              <div><div className="qa-bubble user">{privateText(m.text)}</div><AttachmentList attachments={m.attachments} /></div>
            ) : (
              <div className="qa-answer">
                {(m.teacher || m.personaName) && (
                  <div className="qa-answer-head">
                    <span className="chip accent">{m.personaName ? `${privateText(m.personaName)} · 讲解方式` : '学习助手'}</span>
                    {m.subjName && <span className="chip gray">{privateText(m.subjName)}</span>}
                    {m.coverage && (
                      <span className={`chip ${m.coverage === 'full' ? 'ok' : m.coverage === 'none' ? 'danger' : 'warn'}`}>
                        {m.coverage === 'full' ? '课堂有完整讲解' : m.coverage === 'none' ? '课堂没讲到' : '课堂有部分讲解'}
                      </span>
                    )}
                    {m.streaming && <span className="chip warn">生成中…</span>}
                    {!m.streaming && firstTokenMs && i === msgs.length - 1 && (
                      <span className="chip gray" title="从提问到首字可见的耗时">⚡ 首字 {(firstTokenMs / 1000).toFixed(1)}s</span>
                    )}
                    <button className="btn ghost" onClick={() => speak(privateText(m.answer ?? m.text), i, m.teacher)} title="朗读">
                      {speaking === i ? <Square size={14} /> : <Volume2 size={14} />}
                    </button>
                  </div>
                )}
                {m.streaming && !m.text && (
                  <div className="qa-stream-hint">🔍 已找到课堂材料，正在组织回答…</div>
                )}
                <Markdown
                  text={privateText(m.answer ?? m.text)}
                  slides={privateSlides(m.slides)}
                  citations={privateCitations(m.citations)}
                  onOpenSlide={setZoom}
                />
                <Chart spec={m.chart} />
                {m.sources?.length > 0 && <div className="qa-source-reading">{m.sources.map((source, n) => <div key={source.id}>[资料{n + 1}] {privateText(source.name)} · {source.status === 'read' ? '已读取' : privateText(source.notice || '未读取')}</div>)}</div>}
                {m.slides?.length > 0 && (
                  <details className="slide-drawer">
                    <summary><ImageIcon size={13} /> 本回答引用的 PPT（{m.slides.length} 张，点开看全部）</summary>
                    <SlideGallery slides={m.slides} onZoom={setZoom} redact={privateText} />
                  </details>
                )}
                <Citations list={m.citations} redact={privateText} />
                {m.followups?.length > 0 && (
                  <div className="qa-followups">
                    {m.followups.slice(0, 3).map((f, k) => (
                      <button key={k} className="chip gray" style={{ cursor: 'pointer', border: 'none' }} onClick={() => send(f)}>{privateText(f)}</button>
                    ))}
                  </div>
                )}
                {m.evidence?.length > 0 && (
                  <details className="citation-box">
                    <summary><BookOpen size={13} /> 检索到的课堂片段（{m.evidence.length} 条）</summary>
                    <div className="citation-list">
                      {m.evidence.map((e, k) => (
                        <div key={k} className="citation-item">
                          <span className={`chip ${e.speaker === '同学' ? 'warn' : e.speaker === '未识别' ? 'gray' : 'ok'}`}>
                            {e.speaker === '同学' ? '🙋 同学' : e.speaker === '未识别' ? '❓ 未识别' : '👨‍🏫 老师'}
                          </span>
                          <span className="chip gray">{privateText(e.subj)} {e.date} 第{e.leti}节 {e.time}</span>
                          <div className="citation-quote">{privateText(e.text)}</div>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="qa-msg assistant"><div className="qa-answer"><span className="qa-typing">正在翻阅你的课堂记录…</span></div></div>}
        <div ref={bottomRef} />
      </div>

      {zoom && (
        <div className="slide-zoom" onClick={() => setZoom(null)}>
          <img src={pptSrc(zoom.url)} alt={privateText(zoom.idx)} />
          <div className="slide-zoom-cap">
            {privateText(zoom.idx)} · {zoom.date} 第{zoom.leti}节{zoom.comment ? ` — ${privateText(zoom.comment)}` : ''}
          </div>
        </div>
      )}

      <div className="qa-input-row">
        <AttachmentPicker attachments={attachments} onChange={setAttachments} personaId={personaId} />
        {attachments.length > 0 && <p className="qa-attachment-note" role="status">{attachmentsPending ? '请等待资料读取完成；失败的文件可重试或移除。' : '优先依据所选资料。课程笔记与文本可读取；图片、视频及未接入解析的文档仅保存附件。'}</p>}
        <div className="qa-examples">
          {EXAMPLES.map((e) => <button key={e} className="chip gray" style={{ cursor: 'pointer', border: 'none' }} onClick={() => send(e)}>{e}</button>)}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            aria-label="课堂问题"
            value={input}
            onChange={(e) => { inputRef.current = e.target.value; setInput(e.target.value); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) send(); }}
            placeholder={pickedLecture ? `问第${pickedLecture.leti_number || '?'}节课的内容…` : teacher ? `问 ${displayTeacher(teacher)}课上讲过的问题…` : '问课堂内容，如：老师怎么讲自我披露的？'}
          />
          <button className="btn primary" aria-label="发送课堂问题" onClick={() => send()} disabled={busy || !input.trim() || attachmentsPending}>
            {busy ? '思考中…' : <><Send size={15} /> 提问</>}
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}
