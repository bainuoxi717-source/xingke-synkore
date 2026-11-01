// 每课一篇笔记：读取材料后准备任务，明确确认本次模型调用后生成。
// 内化 ≠ 抄字幕。这里展示的是：这节课讲了什么、核心概念、老师怎么讲、
// 同学讨论了什么、以及可以拿什么去自查。
import { useEffect, useState } from 'react';
import { BookOpen, Sparkles, RefreshCw, CheckCircle2, Circle, Quote, HelpCircle, Users, Lightbulb, GraduationCap } from 'lucide-react';
import { api } from '../api.js';

async function postGeneration(path, body) {
  const response = await fetch('/api' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `生成请求未完成（${response.status}）`);
  return result;
}

export default function LectureNotes() {
  const [lectures, setLectures] = useState([]);
  const [status, setStatus] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [course, setCourse] = useState('');
  const [current, setCurrent] = useState(null);
  const [notes, setNotes] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState('');

  const load = async () => {
    const [l, s, t] = await Promise.all([
      api.get('/lectures').catch(() => ({ lectures: [] })),
      api.get('/lectures/distill-status').catch(() => null),
      api.get('/lectures/note-tasks?limit=1000').catch(() => ({ items: [] })),
    ]);
    setLectures(l.lectures ?? []);
    setStatus(s);
    setTasks(t.items ?? []);
  };
  useEffect(() => { load(); }, []);

  const open = async (lec) => {
    setCurrent(lec);
    setNotes(null);
    setLoading(true);
    try {
      const r = await api.get('/lectures/' + lec.cour_id + '/notes');
      setNotes(r.notes);
    } catch { setNotes(null); }
    setLoading(false);
  };

  const distillOne = async (lec, force = false) => {
    setBusy(String(lec.cour_id));
    try {
      const { plan } = await api.get('/lectures/' + lec.cour_id + '/notes-plan');
      if (!plan?.readyToGenerate) { setToast('这节课可读取的文字还不足，请先补齐材料。'); return; }
      if (!force && plan.status === 'ready') { await open(lec); setToast('当前材料版本已有笔记。'); return; }
      const r = await postGeneration('/lectures/' + lec.cour_id + '/distill', {
        force, approved: true, expectedSourceHash: plan.sourceHash,
        expectedRecipeVersion: plan.recipeVersion, expectedModel: plan.model,
      });
      if (r.ok) { setToast('✅ 已生成笔记'); await open(lec); await load(); }
      else setToast('⚠️ ' + (r.error ?? '失败'));
    } catch (e) { setToast('未完成生成：' + e.message); }
    finally { setBusy(''); setTimeout(() => setToast(''), 6000); }
  };

  const distillPending = async () => {
    setBusy('batch');
    try {
      const queue = await api.get('/lectures/note-tasks?limit=1000');
      // Freeze this exact list before approval; later imports do not join the batch.
      const selected = (queue.items || []).filter((item) => item.readyToGenerate && ['pending', 'stale', 'error'].includes(item.status) && (!course || item.subject === course)).slice(0, 60);
      if (!selected.length) { setToast('当前范围没有需要整理的课次。'); return; }
      setToast(`正在依次整理已批准的 ${selected.length} 节课…`);
      const r = await postGeneration('/lectures/distill-pending', {
        approved: true, courIds: selected.map((item) => item.courId),
        expectedHashes: Object.fromEntries(selected.map((item) => [item.courId, item.sourceHash])),
        expectedRecipeVersion: queue.recipeVersion, expectedModel: queue.model,
      });
      if (!r.ok) throw new Error(r.error || '批次未执行，请重新检查生成计划。');
      setToast(`本轮完成 ${r.done || 0} 节，已有缓存 ${r.skipped || 0} 节，失败 ${r.failed || 0} 节${r.pending ? `，余下 ${r.pending} 节未执行` : ''}。`);
      await load();
      if (current) await open(current);
    } catch (e) { setToast('未完成生成：' + e.message); }
    finally { setBusy(''); setTimeout(() => setToast(''), 7000); }
  };

  const list = course ? lectures.filter((l) => l.subj_name === course) : lectures;
  const subjects = [...new Set(lectures.map((l) => l.subj_name))];
  const taskFor = (id) => tasks.find((item) => Number(item.courId) === Number(id));
  const currentTask = current ? taskFor(current.cour_id) : null;

  return (
    <div className="ln-layout">
      <aside className="ln-side">
        <div className="ln-head">
          <div className="page-title" style={{ fontSize: 17, margin: 0 }}>
            <BookOpen size={18} style={{ verticalAlign: -3 }} /> 课次笔记
          </div>
        </div>
        {status && (
          <div className="ln-stat">
            <Sparkles size={13} />
            已有笔记 <b>{status.distilled}</b> 节
            {status.pending > 0 && <span className="chip warn">待处理 {status.pending}</span>}
          </div>
        )}
        {status?.pending > 0 && (
          <button className="btn primary" style={{ width: '100%' }} disabled={!!busy} onClick={distillPending}>
            {busy === 'batch' ? '正在处理已批准的课次…' : <><Sparkles size={14} /> 查看批量整理计划</>}
          </button>
        )}
        <select value={course} onChange={(e) => setCourse(e.target.value)} style={{ width: '100%' }}>
          <option value="">全部课程（{lectures.length} 节）</option>
          {subjects.map((s) => <option key={s} value={s}>{s}（{lectures.filter((l) => l.subj_name === s).length}）</option>)}
        </select>
        <div className="ln-list">
          {list.map((l) => (
            <div key={l.cour_id} className={`ln-item${current?.cour_id === l.cour_id ? ' active' : ''}`} onClick={() => open(l)}>
              <div className="ln-item-head">
                {l.distilled ? <CheckCircle2 size={13} className="ln-ok" /> : <Circle size={13} className="ln-todo" />}
                <span className="ln-item-title">{String(l.begin_time).slice(5, 10)} 第{l.leti_number}节</span>
              </div>
              <div className="ln-item-sub">{l.subj_name} · {l.teacher}</div>
              <div className="ln-item-meta">
                {l.transcript_chars > 500 ? `${Math.round(l.transcript_chars / 1000)}k 字` : '字幕待生成'}
                {l.ppt_count > 0 && ` · PPT ${l.ppt_count}`}
                {taskFor(l.cour_id) ? ` · ${taskFor(l.cour_id).legacy ? '旧版笔记 · ' : ''}${taskFor(l.cour_id).statusLabel}` : l.distilled ? '' : ' · 未整理'}
              </div>
            </div>
          ))}
        </div>
        {toast && <div className="ln-toast">{toast}</div>}
      </aside>

      <div className="ln-main">
        {!current && (
          <div className="ln-empty">
            <BookOpen size={40} strokeWidth={1.2} />
            <div>选一节课堂 → 看自动整理的笔记</div>
            <div className="ln-empty-sub">
              读取课堂字幕与课件后，先准备待整理列表。<br />确认具体课次与模型调用后，每节课生成一篇笔记。
            </div>
          </div>
        )}
        {current && loading && <div className="ln-empty">正在读取笔记…</div>}
        {current && !loading && !notes && (
          <div className="ln-empty">
            <Circle size={36} strokeWidth={1.2} />
            <div>这节课还没有笔记</div>
            <div className="ln-empty-sub">
              {(currentTask?.readyToGenerate ?? current.transcript_chars >= 300)
                ? '材料已就绪，可先查看本次整理范围与模型用量'
                : '还没有足够的课堂文字，等待读取字幕或课件'}
            </div>
            {(currentTask?.readyToGenerate ?? current.transcript_chars >= 300) && (
              <button className="btn primary" disabled={!!busy} onClick={() => distillOne(current)}>
                {busy === String(current.cour_id) ? '正在整理本节课…' : <><Sparkles size={14} /> 查看本节整理计划</>}
              </button>
            )}
          </div>
        )}

        {current && notes && (
          <div className="ln-notes">
            <div className="ln-notes-head">
              <div>
                <div className="ln-notes-title">{current.subj_name} · 第{current.leti_number}节</div>
                <div className="ln-notes-meta">
                  {String(current.begin_time).slice(0, 16)} · {current.teacher}
                  {notes._meta && ` · 基于 ${Math.round(notes._meta.chars / 1000)}k 字材料`}
                  {current.ppt_count > 0 && ` + ${current.ppt_count} 张 PPT`}
                </div>
              </div>
              <button className="btn ghost" title="查看重新整理计划" aria-label="查看重新整理计划" disabled={!!busy} onClick={() => distillOne(current, true)}>
                <RefreshCw size={14} />
              </button>
            </div>
            {currentTask?.legacy && <div className="section-note">这是一篇旧版笔记，原内容已保留；重新整理前可以先查看本次材料范围与用量。</div>}
            {notes._meta?.coverage && <div className="section-note">已按顺序处理 {notes._meta.chunks} 个分块、{notes._meta.coverage.submittedCharacters} 字现有材料。材料覆盖不等于完整录像覆盖，仍需核对转写遗漏。</div>}

            {notes.summary && (
              <div className="ln-block ln-summary">
                <div className="ln-block-title"><Lightbulb size={14} /> 本节核心</div>
                <p>{notes.summary}</p>
              </div>
            )}

            {notes.outline?.length > 0 && (
              <div className="ln-block">
                <div className="ln-block-title"><BookOpen size={14} /> 讲课脉络</div>
                {notes.outline.map((o, i) => (
                  <div className="ln-outline" key={i}>
                    <div className="ln-outline-title">{i + 1}. {o.title}</div>
                    <ul>{(o.points ?? []).map((p, j) => <li key={j}>{p}</li>)}</ul>
                  </div>
                ))}
              </div>
            )}

            {notes.concepts?.length > 0 && (
              <div className="ln-block">
                <div className="ln-block-title"><GraduationCap size={14} /> 核心概念</div>
                <div className="ln-concepts">
                  {notes.concepts.map((c, i) => (
                    <div className="ln-concept" key={i}>
                      <div className="ln-concept-term">{c.term}{c.where && <span className="chip gray">{c.where}</span>}</div>
                      <div className="ln-concept-def">{c.def}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {notes.cases?.length > 0 && (
              <div className="ln-block">
                <div className="ln-block-title">📎 课上案例</div>
                <ul>{notes.cases.map((c, i) => <li key={i}>{c}</li>)}</ul>
              </div>
            )}

            {notes.discussion?.length > 0 && (
              <div className="ln-block ln-discuss">
                <div className="ln-block-title"><Users size={14} /> 同学讨论（课堂生态）</div>
                <ul>{notes.discussion.map((d, i) => <li key={i}>{d}</li>)}</ul>
              </div>
            )}

            {notes.teacher_style && (
              <div className="ln-block">
                <div className="ln-block-title">🎤 老师讲法特点</div>
                <p>{notes.teacher_style}</p>
              </div>
            )}

            {notes.key_quotes?.length > 0 && (
              <div className="ln-block">
                <div className="ln-block-title"><Quote size={14} /> 金句</div>
                {notes.key_quotes.map((k, i) => (
                  <div className="ln-quote" key={i}>
                    <span className={`chip ${k.speaker === '同学' ? 'warn' : k.speaker === '老师' ? 'ok' : 'gray'}`}>{k.speaker || '未识别'}</span>
                    <span className="chip gray">{k.time}</span>
                    <div>“{k.text}”</div>
                  </div>
                ))}
              </div>
            )}

            {notes.questions?.length > 0 && (
              <div className="ln-block ln-questions">
                <div className="ln-block-title"><HelpCircle size={14} /> 自查问题（拿来自测）</div>
                <ol>{notes.questions.map((q, i) => <li key={i}>{q}</li>)}</ol>
              </div>
            )}
            {notes.review_questions?.length > 0 && <div className="ln-block"><div className="ln-block-title"><HelpCircle size={14} /> 复习问答</div>{notes.review_questions.map((item, index) => <details key={index} style={{ margin: '10px 0' }}><summary>{index + 1}. {item.question}</summary><p>{item.answer}</p>{item.refs?.length > 0 && <small>出处：{item.refs.join('、')}</small>}</details>)}</div>}
            {notes.flashcards?.length > 0 && <div className="ln-block"><div className="ln-block-title"><BookOpen size={14} /> 速记卡</div>{notes.flashcards.map((item, index) => <details key={index} style={{ margin: '10px 0' }}><summary>{item.front}</summary><p>{item.back}</p>{item.refs?.length > 0 && <small>出处：{item.refs.join('、')}</small>}</details>)}</div>}
            {notes.uncertainties?.length > 0 && <div className="ln-block"><div className="ln-block-title">待核实内容</div><ul>{notes.uncertainties.map((text, index) => <li key={index}>{text}</li>)}</ul></div>}
            {notes.sources?.length > 0 && <div className="ln-block"><details><summary>材料来源索引（{notes.sources.length} 条）</summary><ul>{notes.sources.map((source) => <li key={source.id}>[{source.id}] {source.kind === 'slide' ? `PPT第${source.page}页` : '课堂文字'}{source.time ? ` · ${source.time}` : ''}{source.speaker ? ` · ${source.speaker}` : ''}</li>)}</ul></details></div>}
          </div>
        )}
      </div>
    </div>
  );
}
