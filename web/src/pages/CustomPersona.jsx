import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, BookOpen, Check, Download, Fingerprint, Globe2, LoaderCircle, Plus, Search, Sparkles, Trash2, UserRound } from 'lucide-react';
import AttachmentPicker from '../components/Attachments.jsx';
import { savedAttachment } from '../utils/attachmentRefs.js';
import { displayAttachmentName, redactShowcaseText } from '../utils/showcasePrivacy.js';
import '../custom-persona.css';

const STORAGE = 'personal-agent:custom-persona-draft';
const blankMaterial = () => ({ label: '', text: '', url: '', attribution: 'unknown', context: '' });
const blank = () => ({ id: `d-${crypto.randomUUID()}`, name: '', goal: '用这个人的思考与讲解方式，解释课程难点并帮助我进一步思考。', manual: [blankMaterial()], annotations: {}, attachmentIds: [], person: null, mode: '' });
function initial() {
  try { const value = JSON.parse(sessionStorage.getItem(STORAGE)); if (value && /^d-[a-f0-9-]{36}$/.test(value.id)) return { ...blank(), ...value }; } catch {}
  return blank();
}
function returnURL(value) {
  try { const url = new URL(value || '/', window.location.origin); return url.origin === window.location.origin && ['/', '/assistant', '/qa', '/restyle'].includes(url.pathname) ? url : new URL('/', window.location.origin); }
  catch { return new URL('/', window.location.origin); }
}
async function request(path, method = 'GET', body) {
  const response = await fetch('/api/custom-personas' + path, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || '请求未完成'); return result;
}
const normalizeForm = (draft) => ({ id: draft.id, ...draft.input, manual: draft.input.manual.length ? draft.input.manual : [blankMaterial()] });
const comparable = (value) => JSON.stringify({ name: value.name, goal: value.goal, person: value.person || null, mode: value.mode || '',
  manual: (value.manual || []).map(({ label, text, url, attribution, context }) => ({ label, text, url, attribution, context })),
  attachmentIds: (value.attachmentIds || []).map(String), annotations: value.annotations || {} });
const formatTime = (value) => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '';

function Evidence({ items, sources }) {
  return <div className="custom-evidence">{items.map((item, i) => <details key={i}><summary><BookOpen size={12} />{sources.find((s) => s.id === item.sourceId)?.label || item.sourceId}<span>{item.kind === 'direct' ? '原文' : item.kind === 'pattern' ? '模式归纳' : '观察 / 推断'}</span></summary><blockquote>{redactShowcaseText(item.quote)}</blockquote></details>)}</div>;
}
function Profile({ draft }) {
  const profile = draft?.profile;
  if (!profile) return <div className="custom-profile-empty"><img src="/assets/learning-mascot/mascot-smile.png" alt="" /><span>先给我一些真实材料。</span><p>我会提炼他如何拆问题、举例子、做判断，<br />以及在什么时候保留疑问。</p><div><span>方法与触发条件</span><span>表达 DNA</span><span>依据与边界</span></div></div>;
  return <div className="custom-profile-content"><div className="custom-profile-summary">{profile.summary}</div><details className="custom-profile-detail"><summary>查看思考方法与证据</summary>
    <h3>遇到问题，怎么想</h3>{profile.methods.map((item, i) => <article className="custom-method" key={i}><div><span>{String(i + 1).padStart(2, '0')}</span><small>{item.classification}</small></div><h4>{item.name}</h4><p><b>何时使用</b>{item.trigger}</p><ol>{item.steps.map((step, n) => <li key={n}>{step}</li>)}</ol>{item.output && <p><b>得到什么</b>{item.output}</p>}<p className="custom-method-limit"><b>适用边界</b>{item.limits.join('；')}</p><Evidence items={item.evidence} sources={draft.sources} /></article>)}
    {profile.heuristics.length > 0 && <><h3>条件改变，判断也要跟着变</h3>{profile.heuristics.map((item, i) => <div className="custom-rule" key={i}><p>如果 {item.when}，则 {item.then}{item.unless ? `；除非 ${item.unless}` : ''}。</p><Evidence items={item.evidence} sources={draft.sources} /></div>)}</>}
    {profile.expression.length > 0 && <><h3>怎么把话讲明白</h3>{profile.expression.map((item, i) => <div className="custom-rule" key={i}><p>{item.rule}</p><Evidence items={item.evidence} sources={draft.sources} /></div>)}</>}
    {profile.sequence.length > 0 && <><h3>讲解顺序</h3><ol>{profile.sequence.map((step, i) => <li key={i}>{step}</li>)}</ol></>}
    <h3>边界和资料缺口</h3><ul>{[...profile.boundaries, ...profile.gaps, ...profile.tensions].map((item, i) => <li key={i}>{item}</li>)}</ul>
    {profile.tryQuestions.length > 0 && <details className="custom-trial"><summary>保存后，用这些问题试讲</summary><ol>{profile.tryQuestions.map((item, i) => <li key={i}>{item}</li>)}</ol><p>这些是待验证的问题，尚未完成独立保真度评测。</p></details>}
  </details></div>;
}

export default function CustomPersona() {
  const navigate = useNavigate(), location = useLocation(), [form, setForm] = useState(initial);
  const [attachments, setAttachments] = useState(() => form.attachmentIds.map(savedAttachment));
  const [config, setConfig] = useState(null), [draft, setDraft] = useState(null), [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState([]), [plan, setPlan] = useState(null), [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const lock = useRef(false), restored = useRef(false), previewRef = useRef(null);
  const back = returnURL(new URLSearchParams(location.search).get('returnTo'));
  const loadConfig = () => request('/config').then(setConfig).catch((e) => setError(e.message));
  useEffect(() => { loadConfig(); }, []);
  useEffect(() => {
    try { sessionStorage.setItem(STORAGE, JSON.stringify({ ...form, attachmentIds: attachments.filter((a) => a.id).map((a) => a.id) })); } catch {}
  }, [form, attachments]);
  useEffect(() => {
    const requested = new URLSearchParams(location.search).get('draft');
    if (!requested && restored.current) return;
    restored.current = true; let alive = true;
    request(`/drafts/${encodeURIComponent(requested || form.id)}`).then((result) => {
      if (!alive) return; setDraft(result.draft);
      if (requested) { setForm(normalizeForm(result.draft)); setAttachments(result.draft.input.attachmentIds.map(savedAttachment)); setDirty(false); }
      else setDirty(comparable(form) !== comparable(result.draft.input));
    }).catch((e) => { if (alive && requested) setError(e.message); });
    return () => { alive = false; };
  }, [location.search]);
  const update = (patch) => { setForm((value) => ({ ...value, ...patch })); setDirty(true); setPlan(null); setError(''); };
  const material = (index, patch) => update({ manual: form.manual.map((item, i) => i === index ? { ...item, ...patch } : item) });
  const act = async (label, fn) => {
    if (lock.current) return; lock.current = true; setBusy(label); setError(''); setNotice('');
    try { await fn(); } catch (caught) { setError(caught.message || '本次处理未完成'); }
    finally { lock.current = false; setBusy(''); }
  };
  const save = async (removeSourceIds = []) => {
    if (attachments.some((a) => a.status !== 'ready')) throw new Error('请等待资料准备好，或移除未完成的附件');
    const result = await request(`/drafts/${form.id}`, 'PUT', { input: { ...form, attachmentIds: attachments.map((a) => a.id) }, removeSourceIds });
    setDraft(result.draft); setForm(normalizeForm(result.draft)); setDirty(false); return result.draft;
  };
  const run = (action) => act(action, async () => {
    if (action === 'generate') {
      for (const attachment of attachments.filter((item) => /^(audio|video)\//.test(item.content_type || '') || /\.(mp3|wav|flac|m4a|ogg|opus|mp4|mov|webm)$/i.test(item.name))) {
        setBusy('transcribe');
        let progress = await request(`/media/${attachment.id}/transcribe`, 'POST', {}), polls = 0;
        while (progress.state === 'processing' && polls++ < 1200) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          progress = await request(`/media/${attachment.id}`);
        }
        if (progress.state !== 'ready') throw new Error(progress.error || '转写仍在进行，可稍后再试');
      }
      setBusy(action);
    }
    const saved = await save();
    const result = await request(`/drafts/${saved.id}/plan`, 'POST', { action, candidateIds: selected });
    const next = result.plan; setPlan(next);
    if (!next.configured) throw new Error('请先在设置中连接 DeepSeek');
    const executed = await request(`/drafts/${saved.id}/execute`, 'POST', { planId: next.id, approvalHash: next.approvalHash, approved: true });
    setDraft(executed.draft); setDirty(false); loadConfig();
    if (executed.error || executed.result?.error) { setError(executed.error || executed.result.error); return; }
    if (executed.duplicate) { setNotice('这是已处理的调用计划，未重复调用。'); return; }
    setNotice(action === 'discover' ? '' : action === 'research' ? `已读入 ${executed.pagesRead} 篇原文。` : action === 'search' ? '资料线索已找到，选择你要读取的原文。' : action === 'fetch' ? '原文已加入。' : '讲法已生成。');
    if (action === 'fetch') setSelected([]);
    if (action === 'generate') requestAnimationFrame(() => previewRef.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
  });
  const publish = () => act('publish', async () => {
    const saved = await save(); const result = await request(`/drafts/${saved.id}/publish`, 'POST', { profileHash: saved.profileHash });
    back.searchParams.set('personaId', result.personaId); back.hash = ''; navigate(back.pathname + back.search, { replace: true });
  });
  const newDraft = () => act('save', async () => {
    if (form.name.trim() || form.manual.some((item) => item.text.trim()) || attachments.length) { await save(); await loadConfig(); }
    const value = blank(); setForm(value); setAttachments([]); setDraft(null); setSelected([]); setPlan(null); setDirty(false); setError(''); setNotice('');
    navigate(`/personas/custom?${new URLSearchParams({ returnTo: back.pathname + back.search })}`, { replace: true });
  });
  const stale = draft?.stale || dirty, canPublish = !!draft?.profile && !stale && !busy;
  const readable = draft?.sources.filter((source) => source.text) || [];
  const editing = !!form.mode || !!form.person || form.manual.some((item) => item.text.trim()) || attachments.length > 0 || !!draft?.profile;
  const discovery = draft?.input.name === form.name ? draft.discovery : null;
  const people = discovery?.people || [];
  const researchLimits = config?.researchLimits || { maxPages: 10, searchQueries: 3 };
  const choose = (person) => update({ name: person.name, person, mode: 'person' });
  const busyText = busy === 'discover' ? '正在找人…' : busy === 'research' ? '正在搜集并读取原文…' : busy === 'generate' ? '正在蒸馏…' : busy === 'transcribe' ? '正在本机转写音视频…' : '正在保存…';
  return <div className="custom-persona-page custom-persona-simple">
    <div className="custom-page-top"><Link to={back.pathname + back.search}><ArrowLeft size={15} />返回学习</Link><button type="button" className="custom-new-draft" disabled={!!busy} onClick={newDraft}><Plus size={14} />新建</button></div>
    <header className="custom-page-heading"><img src="/assets/learning-mascot/mascot-smile.png" alt="" /><div><span className="custom-overline">A NEW PERSPECTIVE</span><h1>想听谁来讲？</h1><p>输入名字，留住一种思考方式。</p></div></header>
    {error && <div className="custom-alert error" role="alert">{error}{/Key|设置|DeepSeek/.test(error) && <Link to="/settings?focus=deepseekKey">前往设置</Link>}</div>}
    {notice && <div className="custom-alert" role="status">{notice}</div>}
    <fieldset disabled={!!busy} className="custom-input-fieldset">
    {!editing ? <section className="custom-find-person">
      <form className="custom-name-search" onSubmit={(e) => { e.preventDefault(); if (form.name.trim()) run('discover'); }}>
        <Search size={19} aria-hidden="true" /><input aria-label="人物名称" value={form.name} onChange={(e) => update({ name: e.target.value, person: null, mode: '' })} maxLength={60} placeholder="输入你想蒸馏的人" autoComplete="off" autoFocus />
        <button type="submit" disabled={!form.name.trim() || !!busy} aria-label="搜索人物">{busy === 'discover' ? <LoaderCircle size={17} className="custom-spin" /> : <ArrowRight size={19} />}</button>
      </form>
      {discovery && <div className="custom-people-results" aria-label="人物检索结果">
        <div className="custom-results-heading">{people.length ? '你想找的是哪一位？' : '暂时没找到匹配的人物。'}</div>
        {people.map((person) => <button type="button" className="custom-person-result" key={person.id} onClick={() => choose(person)}><UserRound size={19} /><span><strong>{person.name}</strong><small>{person.description}</small></span><ArrowRight size={17} /></button>)}
      </div>}
      <button type="button" className="custom-manual-entry" disabled={!form.name.trim() || !!busy} onClick={() => update({ mode: 'manual', person: null })}>{discovery ? '都不是，自己添加资料' : '用自己的资料创建'}<ArrowRight size={13} /></button>
    </section> : <div className="custom-person-editor">
      <div className="custom-chosen-person"><div className="custom-person-avatar"><UserRound size={21} /></div><div><h2>{form.name}</h2>{form.person?.description && <p>{form.person.description}</p>}{!form.person && <small>用你的资料来认识 TA</small>}</div><button className="custom-text-button" type="button" onClick={newDraft}>重新选人</button></div>
      {form.mode === 'person' && <section className="custom-auto-research"><Globe2 size={20} /><div><h3>让 Agent 搜集</h3><p>最多 {researchLimits.maxPages} 篇，覆盖 {researchLimits.searchQueries} 个检索方向。</p></div><button type="button" className="custom-button secondary" onClick={() => run('research')}>{busy === 'research' ? '搜集中…' : readable.some((s) => s.kind === 'web') ? '再搜集' : '自动搜集'}<ArrowRight size={14} /></button></section>}
      <section className="custom-material-editor"><div className="custom-editor-title"><h3>{form.mode === 'person' ? '也可以补充资料' : '添加资料'}</h3><span>文章 · 视频 · 语音</span></div>
        {form.manual.map((item, index) => <div className="custom-material-entry" key={index}>
          <div className="custom-material-title"><span>材料 {String(index + 1).padStart(2, '0')}</span>{form.manual.length > 1 && <button type="button" className="custom-icon-button" onClick={() => update({ manual: form.manual.filter((_, i) => i !== index) })} aria-label={`移除文字材料 ${index + 1}`}><Trash2 size={14} /></button>}</div>
          <textarea aria-label={`材料 ${index + 1} 原文`} value={item.text} onChange={(e) => material(index, { text: e.target.value })} maxLength={20000} rows={4} placeholder="粘贴 TA 的文章或讲话原文…" />
          <details className="custom-material-options"><summary>标题与来源</summary><input aria-label={`材料 ${index + 1} 标题`} value={item.label} onChange={(e) => material(index, { label: e.target.value })} maxLength={120} placeholder="标题（可选）" /><input aria-label={`材料 ${index + 1} 来源网址`} value={item.url} onChange={(e) => material(index, { url: e.target.value })} placeholder="来源网址（可选）" type="url" maxLength={8192} /><div className="custom-material-meta"><label>归属<select aria-label={`材料 ${index + 1} 归属`} value={item.attribution} onChange={(e) => material(index, { attribution: e.target.value })}><option value="unknown">未核对 / 他人转述</option><option value="target">确认是 TA 的原文</option></select></label><label>情境<input aria-label={`材料 ${index + 1} 情境`} value={item.context} onChange={(e) => material(index, { context: e.target.value })} maxLength={120} placeholder="如：教学、写作" /></label></div></details>
        </div>)}
        <div className="custom-material-tools"><AttachmentPicker attachments={attachments} onChange={(items) => { setAttachments(items); setDirty(true); setPlan(null); }} /><button type="button" className="custom-text-button" disabled={form.manual.length >= 12} onClick={() => update({ manual: [...form.manual, blankMaterial()] })}><Plus size={14} />再加一段文字</button></div>
      </section>
      {draft?.sources.length > 0 && <details className="custom-source-review"><summary>{readable.length} 份已读资料<span>{readable.reduce((sum, s) => sum + s.text.length, 0).toLocaleString()} 字</span></summary>{draft.sources.map((source) => <article className="custom-read-source" key={source.id}><div><strong>{redactShowcaseText(source.label)}</strong><span>{source.text ? `${source.text.length.toLocaleString()} 字` : '待读取'}</span></div>{source.notice && <p className="custom-source-notice">{source.notice}</p>}{source.url && <a href={source.url} target="_blank" rel="noreferrer">查看来源 <ArrowRight size={11} /></a>}{!source.id.startsWith('manual-') && <div className="custom-material-meta"><label>归属<select aria-label={`${source.label} 的资料归属`} value={form.annotations[source.id]?.attribution || source.attribution} onChange={(e) => update({ annotations: { ...form.annotations, [source.id]: { context: source.context || '', ...form.annotations[source.id], attribution: e.target.value } } })}><option value="unknown">未核对 / 二次整理</option><option value="target">确认是 TA 的原文</option></select></label><label>情境<input aria-label={`${source.label} 的情境`} value={form.annotations[source.id]?.context ?? source.context} maxLength={120} onChange={(e) => update({ annotations: { ...form.annotations, [source.id]: { attribution: source.attribution, ...form.annotations[source.id], context: e.target.value } } })} /></label></div>}{source.text && <details><summary>查看文字</summary><pre>{redactShowcaseText(source.text)}</pre></details>}{source.id.startsWith('remote-') && <button type="button" className="custom-text-button" onClick={() => act('save', async () => { await save([source.id]); setNotice('已移除。'); })}><Trash2 size={12} />移除</button>}</article>)}</details>}
      <details className="custom-purpose"><summary>调整蒸馏方向</summary><label className="custom-field">想借用他的哪种能力<textarea value={form.goal} onChange={(e) => update({ goal: e.target.value })} maxLength={1000} rows={2} /></label></details>
      <div className="custom-generation-bar"><button type="button" className="custom-button secondary" onClick={() => act('save', async () => { await save(); loadConfig(); setNotice('草稿已保存。'); })}>存为草稿</button><button type="button" className="custom-button primary" disabled={!form.name.trim() || attachments.some((a) => a.status !== 'ready') || !(form.manual.some((m) => m.text.trim()) || attachments.length || readable.length)} onClick={() => run('generate')}><Sparkles size={16} />{busy === 'generate' || busy === 'transcribe' ? '正在蒸馏…' : '开始蒸馏'}<ArrowRight size={15} /></button></div>
    </div>}
    </fieldset>
    {busy && <div className="custom-working" role="status"><LoaderCircle size={16} className="custom-spin" />{busyText}</div>}
    {!!draft?.profile && <section className="custom-profile-panel" ref={previewRef}><div className="custom-profile-heading"><span>YOUR NEW PERSPECTIVE</span><h2>{draft.input.name}</h2><small>{stale ? '资料有变化，需要重新蒸馏' : '讲法已就绪'}</small></div><Profile draft={draft} /><div className="custom-profile-actions"><button type="button" className="custom-button primary" disabled={!canPublish} onClick={publish}><Check size={16} />保存并使用<ArrowRight size={16} /></button>{!stale && <a className="custom-export" href={`/api/custom-personas/drafts/${draft.id}/skill`} download><Download size={14} />导出 SKILL.md</a>}</div></section>}
    {!!config?.drafts.length && <details className="custom-saved-drafts"><summary>我的草稿<span>{config.drafts.length}</span></summary>{config.drafts.map((item) => <button className={`custom-draft-row${item.id === form.id ? ' is-active' : ''}`} key={item.id} type="button" disabled={!!busy} onClick={() => navigate(`/personas/custom?${new URLSearchParams({ returnTo: back.pathname + back.search, draft: item.id })}`)}><span>{item.name}<small>{formatTime(item.updatedAt)} · {item.generated ? '已有讲法' : '资料草稿'}</small></span><ArrowRight size={14} /></button>)}</details>}
    <footer className="custom-method-credit"><Fingerprint size={12} /><a href={config?.method.repository || 'https://github.com/alchaincyf/nuwa-skill'} target="_blank" rel="noreferrer">女娲蒸馏</a></footer>
  </div>;
}
