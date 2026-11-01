// 内容来自源课程，讲法来自已蒸馏老师或已审读的人物配置。
import { useEffect, useRef, useState } from 'react';
import { Mic2, Sparkles, RefreshCw, BookOpen, UserRound, AlertTriangle, Layers, Volume2, Square, ListVideo, Loader2 } from 'lucide-react';
import { api } from '../api.js';
import useVoiceReadout from '../hooks/useVoiceReadout.js';
import VoiceSelect from '../components/VoiceSelect.jsx';
import { displayTeacher, redactShowcaseText } from '../utils/showcasePrivacy.js';

export default function Restyle() {
  const [scopes, setScopes] = useState({ courses: [], teachers: [], personas: [] });
  const [course, setCourse] = useState(null);          // {subject, teacher, lectures}
  const [lectures, setLectures] = useState([]);
  const [picked, setPicked] = useState(null);          // 选中的课次
  const [personaId, setPersonaId] = useState(() => new URLSearchParams(window.location.search).get('personaId') || '');
  const selectedPersona = scopes.personas.find((persona) => persona.id === personaId);
  const styleTeacher = selectedPersona?.kind === 'teacher' ? selectedPersona.teacher : '';
  const [mode, setMode] = useState('full');
  const [styleCard, setStyleCard] = useState(null);
  const [building, setBuilding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [status, setStatus] = useState('');
  const [err, setErr] = useState('');
  const [timing, setTiming] = useState(null);
  // 朗读
  const readout = useVoiceReadout();
  const speaking = readout.active !== null;
  const speakInfo = readout.progress;
  const stopSpeak = readout.stop;
  // 批量
  const [batch, setBatch] = useState(null);
  const [batchMsg, setBatchMsg] = useState('');
  const bodyRef = useRef(null);
  const runController = useRef(null);
  const knownTeachers = [...scopes.courses.map((item) => item.teacher), ...scopes.personas.filter((item) => item.kind === 'teacher').flatMap((item) => [item.teacher, item.name]), picked?.teacher].filter(Boolean);
  const privateText = (value) => redactShowcaseText(value, knownTeachers);
  const personaName = (persona) => persona?.kind === 'teacher' ? displayTeacher(persona.name) : privateText(persona?.name || '学习助手');

  useEffect(() => {
    let active = true;
    (async () => {
      const r = await api.get('/restyle/scopes');
      if (!active) return;
      const nextScopes = { courses: r.courses ?? [], teachers: r.teachers ?? [], personas: r.personas ?? [] };
      setScopes(nextScopes);
      const courId = new URLSearchParams(window.location.search).get('courId');
      if (courId) {
        const { lecture } = await api.get('/lectures/' + encodeURIComponent(courId));
        if (!active) return;
        const sourceCourse = nextScopes.courses.find((item) => item.subject === lecture.subj_name && item.teacher === lecture.teacher)
          || { subject: lecture.subj_name, teacher: lecture.teacher, lectures: 1 };
        if (!nextScopes.courses.includes(sourceCourse)) setScopes({ ...nextScopes, courses: [...nextScopes.courses, sourceCourse] });
        const result = await api.get('/restyle/lectures?subject=' + encodeURIComponent(sourceCourse.subject) + '&teacher=' + encodeURIComponent(sourceCourse.teacher));
        if (!active) return;
        const selected = { ...lecture, chars: String(lecture.transcript || '').length, has_notes: !!lecture.distill_json };
        const courseLectures = result.lectures ?? [];
        setCourse(sourceCourse);
        setLectures(courseLectures.some((item) => String(item.cour_id) === String(lecture.cour_id)) ? courseLectures : [...courseLectures, selected]);
        setPicked(selected);
      } else if (nextScopes.courses.length) await pickCourse(nextScopes.courses[0]);
    })().catch((e) => { if (active) setErr(e.message); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => { runController.current?.abort(); stopSpeak(); }, []);

  const pickCourse = async (c) => {
    setCourse(c);
    setPicked(null);
    setText(''); setTiming(null); setErr('');
    try {
      const r = await api.get('/restyle/lectures?subject=' + encodeURIComponent(c.subject) + '&teacher=' + encodeURIComponent(c.teacher));
      setLectures(r.lectures ?? []);
    } catch { setLectures([]); }
  };

  // 选课次：先看有没有生成过的缓存，有就直接显示（秒开）
  const pickLecture = (l) => {
    setPicked(l); setErr(''); setTiming(null); setText('');
    stopSpeak();
  };
  useEffect(() => {
    let active = true;
    setText(''); setTiming(null); setStatus('');
    if (!picked || (personaId && !selectedPersona?.ready)) return () => { active = false; };
    api.get(`/restyle/cached?courId=${picked.cour_id}&styleTeacher=${encodeURIComponent(styleTeacher)}&personaId=${encodeURIComponent(personaId)}&mode=${mode}`).then((r) => {
      if (active && !runController.current && r.cached && r.markdown) { setText(r.markdown); setStatus('已读取同一资料与人物版本的讲解'); }
    }).catch(() => {});
    return () => { active = false; };
  }, [picked?.cour_id, personaId, mode, selectedPersona?.version]);

  const speakAll = () => readout.read(privateText(text.split('### 原文索引')[0]), 'lecture');

  const startBatchRun = async () => {
    if (!course || batch?.running) return;
    setErr(''); setBatchMsg('正在启动批量任务…');
    try {
      const r = await api.post('/restyle/batch', { subject: course.subject, sourceTeacher: course.teacher, styleTeacher, personaId, mode });
      setBatchMsg(`已启动：共 ${r.total} 节`);
      setBatch({ running: true, total: r.total, done: 0 });
    } catch (e) { setErr('启动失败：' + e.message); setBatchMsg(''); }
  };

  const stopBatchRun = async () => {
    await api.post('/restyle/batch/stop', {}).catch(() => {});
    setBatchMsg('已请求停止');
  };

  // 轮询批量进度
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const s = await api.get('/restyle/batch/status');
        if (!alive) return;
        setBatch(s);
        if (s.stopping) setBatchMsg('正在停止当前生成，不会继续下一节课…');
        else if (s.running) setBatchMsg(`${s.done}/${s.total} · ${s.current || '…'}`);
        else if (s.total) setBatchMsg(`${s.cancelled ? '已停止' : '完成'} ${s.done}/${s.total}${s.skipped ? ` · 跳过 ${s.skipped}` : ''}${s.failed ? ` · 失败 ${s.failed}` : ''}`);
      } catch { /* 忽略 */ }
    };
    tick();
    const iv = setInterval(tick, 2500);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  // 读讲法画像
  const loadStyle = async (teacher, force = false) => {
    if (!teacher) return;
    setBuilding(true); setErr('');
    try {
      const r = await api.post('/restyle/style', { teacher, force });
      setStyleCard(r.style);
      const updated = await api.get('/restyle/scopes');
      setScopes({ courses: updated.courses ?? [], teachers: updated.teachers ?? [], personas: updated.personas ?? [] });
    } catch (e) { setErr('讲法画像生成失败：' + e.message); setStyleCard(null); }
    finally { setBuilding(false); }
  };

  const run = async () => {
    if (!picked || busy) return;
    if (personaId && !selectedPersona?.ready) { setErr('请先蒸馏该老师，或选择已有的人物讲法'); return; }
    const controller = new AbortController();
    runController.current = controller;
    setBusy(true); setText(''); setTiming(null); setErr(''); setStatus('准备中…');
    const t0 = Date.now();
    let firstAt = 0, buf = '';
    try {
      const res = await fetch('/api/restyle/stream', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courId: picked.cour_id, styleTeacher, personaId, mode }), signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
      const rd = res.body.getReader(); const dec = new TextDecoder();
      let raw = '';
      for (;;) {
        const { done, value } = await rd.read();
        if (done) break;
        raw += dec.decode(value, { stream: true });
        const parts = raw.split('\n\n'); raw = parts.pop() ?? '';
        for (const p of parts) {
          const ev = /^event: (\w+)/m.exec(p)?.[1];
          const dm = /^data: (.*)$/m.exec(p);
          if (!ev || !dm) continue;
          let d; try { d = JSON.parse(dm[1]); } catch { continue; }
          if (ev === 'status') setStatus(d.text ?? '');
          else if (ev === 'delta') {
            if (!firstAt) firstAt = Date.now() - t0;
            buf += d.text; setText(buf);
            if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
          } else if (ev === 'done') {
            buf = d.markdown || buf; setText(buf);
            setTiming({ firstTokenMs: d.timing?.firstTokenMs ?? firstAt, totalMs: d.timing?.totalMs ?? (Date.now() - t0), chars: buf.length });
            if (d.styleCard) setStyleCard(d.styleCard);
            setStatus('');
          } else if (ev === 'error') { setErr(d.message ?? '生成失败'); setStatus(''); }
        }
      }
    } catch (e) { setErr(controller.signal.aborted ? '已停止本次讲解。' : e.message); }
    finally { setBusy(false); if (runController.current === controller) runController.current = null; }
  };

  const courseKey = (c) => c.subject + '|' + c.teacher;

  return (
    <div className="ln-layout">
      <aside className="ln-side">
        <div className="ln-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Mic2 size={16} /> <b>人物讲解</b>
          </div>
          <div className="ln-stat">原课内容 · 不同人物的讲解方式</div>
        </div>

        <label className="section-note" style={{ margin: '0 0 4px' }}>① 选一门必须学的课</label>
        <select
          disabled={busy}
          value={course ? courseKey(course) : ''}
          onChange={(e) => {
            const c = scopes.courses.find((x) => courseKey(x) === e.target.value);
            if (c) pickCourse(c);
          }}
          style={{ width: '100%', marginBottom: 10 }}
        >
          {scopes.courses.map((c) => (
            <option key={courseKey(c)} value={courseKey(c)}>
              {privateText(c.subject)} · {displayTeacher(c.teacher)}（{c.lectures} 节）
            </option>
          ))}
        </select>

        <label className="section-note" style={{ margin: '0 0 4px' }}>② 选一节课</label>
        <div className="ln-list">
          {lectures.map((l) => (
            <div
              key={l.cour_id}
              className={'ln-item' + (picked?.cour_id === l.cour_id ? ' active' : '')}
              onClick={() => { if (!busy) pickLecture(l); }}
            >
              <div className="ln-item-head">
                <span className="ln-item-title">第{l.leti_number}节</span>
                {l.has_notes ? <span className="ln-ok">✓</span> : <span className="ln-todo">·</span>}
              </div>
              <div className="ln-item-sub">{String(l.begin_time).slice(0, 10)}</div>
              <div className="ln-item-meta">{Math.round(l.chars / 1000)}k 字</div>
            </div>
          ))}
          {!lectures.length && <div className="ln-empty">这门课还没有可用字幕</div>}
        </div>
      </aside>

      <main className="ln-main">
        {err && <div className="card" style={{ borderColor: 'var(--danger)' }}><span style={{ color: 'var(--danger)' }}>⚠️ {privateText(err)}</span></div>}
        {!picked ? (
          <div className="ln-empty" style={{ paddingTop: 80 }}>
            <Layers size={30} style={{ opacity: .35 }} />
            <div style={{ marginTop: 10 }}>左边选一节课</div>
            <div className="ln-empty-sub">选择已蒸馏的老师或人物 skill，用他的讲解方式重新学习</div>
          </div>
        ) : (
          <>
            <div className="card">
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="chip course"><BookOpen size={12} /> {privateText(picked.subj_name)}</span>
                <span className="chip gray">第{picked.leti_number}节 · {String(picked.begin_time).slice(0, 10)}</span>
                <span className="chip gray">主讲 {displayTeacher(picked.teacher)}</span>
                <div style={{ flex: 1 }} />
                <span className="chip gray"><UserRound size={12} /> 讲解人物</span>
                <select aria-label="选择讲解人物" disabled={busy || building} value={personaId} onChange={(e) => { setPersonaId(e.target.value); setStyleCard(null); setErr(''); stopSpeak(); }}>
                  <option value="">学习助手 · 清晰讲解</option>
                  {scopes.personas.map((persona) => (
                    <option key={persona.id} value={persona.id} disabled={persona.id.startsWith('invalid:')}>
                      {personaName(persona)} · {persona.kind === 'teacher' ? '课堂老师' : '人物 skill'}{persona.ready ? '' : '（尚未蒸馏）'}
                    </option>
                  ))}
                </select>
                <VoiceSelect readout={readout} />
                <div className="mode-cfg-seg">
                  <button disabled={busy} className={'btn sm' + (mode === 'full' ? ' primary' : '')} onClick={() => setMode('full')}>按原文逐段讲</button>
                  <button disabled={busy} className={'btn sm' + (mode === 'key' ? ' primary' : '')} onClick={() => setMode('key')}>提炼重点</button>
                </div>
                <button className="btn primary" onClick={run} disabled={busy || building || (!!personaId && !selectedPersona?.ready)}>
                  {busy ? <><RefreshCw size={14} className="spin" /> 正在讲解…</> : <><Sparkles size={14} /> 开始讲解</>}
                </button>
                {busy && <button className="btn sm" onClick={() => runController.current?.abort()}><Square size={12} /> 停止</button>}
                {batch?.running
                  ? <button className="btn sm ghost" onClick={stopBatchRun} disabled={batch.stopping}><Square size={12} /> {batch.stopping ? '正在停止' : '停止批量'}</button>
                  : <button className="btn sm ghost" onClick={startBatchRun} disabled={!course || busy || building || (!!personaId && !selectedPersona?.ready)} title="用所选人物讲解整门课">
                      <ListVideo size={12} /> 整门课批量生成
                    </button>}
              </div>

              {batchMsg && (
                <div className="section-note" style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {batch?.running && <Loader2 size={12} className="spin" />}
                  {privateText(batchMsg)}
                  {batch?.total > 0 && (
                    <span style={{ flex: 1, maxWidth: 260, height: 6, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
                      <span style={{ display: 'block', height: '100%', width: Math.round(100 * (batch.done || 0) / batch.total) + '%', background: 'var(--accent)', transition: 'width .3s' }} />
                    </span>
                  )}
                </div>
              )}

              {selectedPersona && (
                <div style={{ marginTop: 10 }}>
                  {building && <div className="section-note">正在从「{personaName(selectedPersona)}」的课堂里提炼讲法特征…</div>}
                  {!building && (
                    <div className="section-note" style={{ background: 'var(--bg)', padding: '8px 10px', borderRadius: 8 }}>
                      <b>{personaName(selectedPersona)} 的讲法</b>：{privateText(styleCard?.['一句话风格'] || selectedPersona.summary)}
                      {selectedPersona.kind === 'teacher' && <button className="btn sm ghost" style={{ marginLeft: 8 }} disabled={busy} onClick={() => loadStyle(styleTeacher, selectedPersona.ready)}>
                        <RefreshCw size={11} /> {selectedPersona.ready ? '女娲 · 重新蒸馏' : '女娲 · 蒸馏讲法'}
                      </button>}
                      <div style={{ marginTop: 4 }}>选择人物只读取已有配置；生成时保留原课知识和出处。</div>
                    </div>
                  )}
                </div>
              )}

              <div className="section-note" style={{ marginTop: 8 }}>
                <AlertTriangle size={12} /> 原课提供知识，人物提供讲解方式。所有可用原文会分段处理，引用 <code>[源N]</code> 可对照文末原文索引；人物风格模拟不代表本人参与。
              </div>
            </div>

            {busy && !text && (
              <div className="card"><div className="section-note">{privateText(status || '正在准备…')}</div></div>
            )}

            {text && (
              <div className="card" ref={bodyRef}>
                <div className="ln-notes-head">
                  <div className="ln-notes-title">
                    {selectedPersona ? `${personaName(selectedPersona)} 的讲法` : '学习助手'} · {privateText(picked.subj_name)} 第{picked.leti_number}节
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <span className="ln-notes-meta">
                      {timing ? `首字 ${(timing.firstTokenMs / 1000).toFixed(1)}s · 共 ${timing.chars} 字 · ${(timing.totalMs / 1000).toFixed(1)}s` : (busy ? '生成中…' : (text ? '已生成' : ''))}
                    </span>
                    {speaking
                      ? <button className="btn sm" onClick={stopSpeak}><Square size={12} /> 停止朗读 <span style={{ opacity: .75 }}>{speakInfo}</span></button>
                      : <button className="btn sm ghost" onClick={speakAll} disabled={busy} title={readout.voice ? `用「${displayTeacher(readout.voice)}」的音色朗读` : '用系统语音朗读'}>
                          <Volume2 size={13} /> 读给我听
                        </button>}
                  </div>
                </div>
                <MarkdownLite text={privateText(text.split('### 原文索引')[0])} />
                {text.includes('### 原文索引') && <details className="citation-box"><summary>展开原文索引，核对讲解来源</summary><MarkdownLite text={privateText(text.split('### 原文索引').slice(1).join('### 原文索引'))} /></details>}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

/* 轻量 markdown 渲染（与课次笔记一致的三段结构） */
function MarkdownLite({ text }) {
  const blocks = String(text).split(/\n{2,}/);
  const out = [];
  let list = null;
  const flush = () => { if (list) { out.push(<ul className="md-list" key={'l' + out.length}>{list}</ul>); list = null; } };

  blocks.forEach((raw, i) => {
    const b = raw.trim();
    if (!b) return;
    if (/^###\s/.test(b)) { flush(); out.push(<div className="md-h" key={i} style={{ fontSize: 15 }}>{b.replace(/^###\s/, '')}</div>); return; }
    if (/^##\s/.test(b)) { flush(); out.push(<div className="md-h" key={i}>{b.replace(/^##\s/, '')}</div>); return; }
    if (/^#\s/.test(b)) { flush(); out.push(<div className="md-h" key={i}>{b.replace(/^#\s/, '')}</div>); return; }
    if (/^[-*]\s/m.test(b) && b.split('\n').every((x) => /^[-*]\s/.test(x.trim()) || !x.trim())) {
      flush();
      out.push(<ul className="md-list" key={i}>{b.split('\n').filter((x) => x.trim()).map((x, k) => (
        <li key={k} dangerouslySetInnerHTML={{ __html: inline(x.replace(/^\s*[-*]\s/, '')) }} />
      ))}</ul>);
      return;
    }
    flush();
    out.push(<p key={i} style={{ margin: '0 0 10px', lineHeight: 1.9 }} dangerouslySetInnerHTML={{ __html: inline(b) }} />);
  });
  flush();
  return <div className="md-body">{out}</div>;
}

function inline(s) {
  let h = String(s)
    .replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code class="md-code">$1</code>')
    .replace(/\[源(\d+)\]/g, '<span class="chip gray" style="font-size:11px">源$1</span>')
    .replace(/\*(?!\*)([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/^>\s?/, '');
  return h;
}
