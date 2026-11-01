import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Upload, Library, BookOpen, X, Search, ChevronLeft, Check, LoaderCircle } from 'lucide-react';
import Markdown from './Markdown.jsx';
import { attachmentEndpoint } from '../utils/attachmentRefs.js';
import { displayTeacher, displayCourse, displayFilename, displayAttachmentName, redactShowcaseText } from '../utils/showcasePrivacy.js';

async function request(url, options) {
  const response = await fetch(url, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || result.message || '读取失败');
  return result;
}
export default function LearningSourceDialog({ onClose, onLocal, onAdd, selectedIds = [], personaId = '' }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState('local');
  const [catalog, setCatalog] = useState(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [preview, setPreview] = useState(null);
  const [plan, setPlan] = useState(null);
  const dialog = useRef(null);
  const load = async () => { try { setError(''); setCatalog(await request('/api/learning-sources')); } catch (e) { setError(e.message); } };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    const keydown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab') return;
      const nodes = [...dialog.current.querySelectorAll('button:not([disabled]), input, a[href], [tabindex="0"]')];
      if (!nodes.length) return;
      if (event.shiftKey && (document.activeElement === nodes[0] || document.activeElement === dialog.current)) { event.preventDefault(); nodes.at(-1).focus(); }
      else if (!event.shiftKey && (document.activeElement === nodes.at(-1) || document.activeElement === dialog.current)) { event.preventDefault(); nodes[0].focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', keydown); previous?.focus(); };
  }, [onClose]);
  const choose = async (id, available = true) => {
    if (selectedIds.length >= 20) { setError('每次最多添加20份资料，请先移除部分已选资料。'); return; }
    setBusy(id); setError('');
    try {
      if (!available && id.startsWith('material:')) await request(`/api/materials/${id.split(':')[1]}/download`, { method: 'POST' });
      const result = await request(attachmentEndpoint(id));
      onAdd({ ...result.attachment, localId: `source-${id}`, status: 'ready' });
    } catch (e) { setError(e.message); }
    finally { setBusy(''); }
  };
  const showNote = async (item) => {
    setBusy(`lecture-note:${item.courId}`); setError(''); setPlan(null);
    try { const result = await request(attachmentEndpoint(`lecture-note:${item.courId}`)); setPreview({ ...result, item }); }
    catch (e) { setError(e.message); } finally { setBusy(''); }
  };
  const prepare = async (item) => {
    setError(''); setBusy(`lecture-note:${item.courId}`);
    try { const result = await request(`/api/lectures/${item.courId}/notes-plan`); setPlan(result.plan); }
    catch (e) { setError(e.message); } finally { setBusy(''); }
  };
  const generate = async () => {
    if (!plan) return;
    if (plan.configured === false) { setError('尚未连接模型，请先在设置中配置。'); return; }
    setBusy(`lecture-note:${plan.courId}`); setError('');
    try {
      const result = await request(`/api/lectures/${plan.courId}/distill`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approved: true, force: true, expectedSourceHash: plan.sourceHash, expectedRecipeVersion: plan.recipeVersion, expectedModel: plan.model }) });
      if (!result.ok) throw new Error(result.error || result.message || '笔记未生成，请重新查看整理计划');
      setPlan(null); await load();
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  };
  const query = search.toLocaleLowerCase().trim();
  const materials = (catalog?.materials || []).filter((item) => `${item.name} ${item.courseName}`.toLocaleLowerCase().includes(query));
  const notes = (catalog?.notes?.items || []).filter((item) => `${item.subject} ${item.teacher} ${item.beginTime} 第${item.leti}节`.toLocaleLowerCase().includes(query));
  return createPortal(<div className="source-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="source-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="source-dialog-title" tabIndex={-1}>
      <header><div><span className="source-eyebrow">YOUR LEARNING MATERIALS</span><h2 id="source-dialog-title">添加学习资料</h2></div><button type="button" className="source-close" onClick={onClose} aria-label="关闭资料选择"><X size={20} /></button></header>
      <div className="source-tabs" role="tablist" aria-label="资料来源">{[['local', Upload, '本地文件'], ['materials', Library, '课件'], ['notes', BookOpen, '课程笔记']].map(([id, Icon, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => { setTab(id); setPreview(null); setPlan(null); setSearch(''); }}><Icon size={16} />{label}</button>)}</div>
      <div className="source-body" role="tabpanel">
        {error && <div className="source-error" role="alert">{error}<button type="button" onClick={load}>重新读取</button></div>}
        {tab === 'local' ? <div className="source-local"><Upload size={28} /><h3>从你的电脑添加</h3><p>图片、视频、文档和其他格式<br />支持多选，每个文件不超过 100 MB</p><button type="button" className="source-primary" onClick={() => { onLocal(); onClose(); }}>选择本地文件</button><small>文本与课程笔记可用于问答；图片、视频等内容解析尚未接入。</small></div> : preview ? <div className="source-preview"><button type="button" className="source-back" onClick={() => setPreview(null)}><ChevronLeft size={15} />返回课程笔记</button><h3>{displayAttachmentName({ ...preview.attachment, leti: preview.item.leti })}</h3><div className="source-preview-markdown"><Markdown text={redactShowcaseText(preview.markdown, [preview.item.teacher])} /></div><button type="button" className="source-primary" onClick={() => choose(preview.attachment.id)} disabled={selectedIds.includes(preview.attachment.id) || !!busy}>{selectedIds.includes(preview.attachment.id) ? '已添加' : '添加到问题'}</button></div> : <>
          <label className="source-search"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tab === 'notes' ? '搜索老师、课程、日期或课次' : '搜索课件或课程'} aria-label="搜索学习资料" /></label>
          <div className="source-summary">{tab === 'notes' ? `每节课一篇 · ${catalog?.notes?.total ?? '…'} 节课堂` : `${materials.length} 份课件`}{tab === 'notes' && <small>已整理 {(catalog?.notes?.counts?.ready || 0) + (catalog?.notes?.counts?.stale || 0)} 篇 · 待整理 {catalog?.notes?.counts?.pending || 0} 节 · 笔记保留原老师与课次。</small>}</div>
          {plan && <div className="source-plan"><b>整理本节课的笔记</b><p>{displayCourse(plan.subject)} · {displayTeacher(plan.teacher)} · 第{plan.leti}节</p><p>预计 {plan.estimatedCalls} 次模型请求；现有笔记会保留到新笔记生成成功。</p>{plan.configured === false && <p>尚未连接模型，连接后即可整理。</p>}<div>{plan.configured === false && <button type="button" className="source-primary" onClick={() => { navigate('/settings'); onClose(); }}>连接模型</button>}<button type="button" className="source-primary" disabled={!!busy || !plan.estimatedCalls || plan.configured === false} onClick={generate}>{busy ? '正在整理…' : '确认本次调用并整理'}</button><button type="button" className="source-back" onClick={() => setPlan(null)}>取消</button></div></div>}
          {!catalog && !error && <p className="source-empty"><LoaderCircle size={18} className="attachment-spinner" />正在读取资料…</p>}
          <div className="source-results">{tab === 'materials' ? materials.map((item) => <article className="source-row" key={item.id}><Library size={19} /><div><b>{displayFilename(item.name, 'material')}</b><small>{displayCourse(item.courseName) || '未归属课程'}{!item.available && ' · 尚未下载'}</small></div><button type="button" onClick={() => choose(item.id, item.available)} disabled={!!busy || selectedIds.includes(item.id)}>{selectedIds.includes(item.id) ? <><Check size={13} />已添加</> : busy === item.id ? '读取中…' : item.available ? '添加' : '下载并添加'}</button></article>) : notes.map((item) => {
            const id = `lecture-note:${item.courId}`;
            return <article className="source-row" key={id}><BookOpen size={19} /><div><b>{displayCourse(item.subject)} · 第{item.leti || '?'}节</b><small>{displayTeacher(item.teacher)} · {String(item.beginTime || '').slice(0, 10)} <span className={`source-state ${item.hasNotes ? 'ready' : ''}`}>{item.statusLabel || item.status}</span></small></div><div className="source-row-actions">{item.status !== 'waiting' && <button type="button" onClick={() => { navigate(`/restyle?${new URLSearchParams({ courId: item.courId, personaId })}`); onClose(); }} disabled={!!busy}>重讲</button>}{item.hasNotes && item.status !== 'ready' && <button type="button" onClick={() => prepare(item)} disabled={!!busy}>更新笔记</button>}{item.hasNotes && <button type="button" onClick={() => showNote(item)} disabled={!!busy}>预览</button>}<button type="button" onClick={() => item.hasNotes ? choose(id) : prepare(item)} disabled={!!busy || selectedIds.includes(id) || item.status === 'waiting'}>{selectedIds.includes(id) ? <><Check size={13} />已添加</> : busy === id ? '处理中…' : item.hasNotes ? '添加' : item.status === 'waiting' ? '等待课堂文字' : '整理笔记'}</button></div></article>;
          })}</div>
          {catalog && (tab === 'materials' ? !materials.length : !notes.length) && <p className="source-empty">{query ? '没有匹配的资料，试试其他关键词。' : tab === 'materials' ? '还没有课件。你可以先添加本地文件。' : '还没有读取到课堂记录。'}</p>}
        </>}
      </div>
      <footer><span>已选 {selectedIds.length} 份资料</span><button type="button" className="source-primary" onClick={onClose}>完成</button></footer>
    </section>
  </div>, document.body);
}
