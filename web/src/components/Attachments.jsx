import { useCallback, useEffect, useRef, useState } from 'react';
import { Paperclip, FileText, Film, FileAudio, File, X, RotateCw, LoaderCircle, Check, Download } from 'lucide-react';
import '../attachments.css';
import LearningSourceDialog from './LearningSourceDialog.jsx';
import { attachmentEndpoint } from '../utils/attachmentRefs.js';
import { displayAttachmentName } from '../utils/showcasePrivacy.js';

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const isRasterImage = (type = '') => /^image\/(png|jpeg|jpg|gif|webp|avif|bmp)$/i.test(type);
export function formatFileSize(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function safeAttachmentURL(value) {
  if (!value) return '';
  try {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin && (url.pathname.startsWith('/api/attachments/') || url.pathname.startsWith('/api/learning-sources/')) ? url.href : '';
  } catch { return ''; }
}
function FileVisual({ attachment }) {
  const [failed, setFailed] = useState(false);
  const source = attachment.localPreview || safeAttachmentURL(attachment.preview_url);
  if (isRasterImage(attachment.content_type) && source && !failed) return <img src={source} alt="" onError={() => setFailed(true)} />;
  const Icon = attachment.content_type?.startsWith('video/') ? Film : attachment.content_type?.startsWith('audio/') ? FileAudio : /pdf|text|document|sheet|presentation/.test(attachment.content_type || '') ? FileText : File;
  return <Icon size={19} strokeWidth={1.6} />;
}

export function AttachmentList({ attachments = [] }) {
  if (!attachments.length) return null;
  return <div className="attachment-list attachment-list-readonly" aria-label="本次附带的文件">{attachments.map((attachment) => <div className="attachment-chip" key={attachment.localId || attachment.id}>
    <span className="attachment-visual"><FileVisual attachment={attachment} /></span>
    <span className="attachment-details"><span className="attachment-name" title={displayAttachmentName(attachment)}>{displayAttachmentName(attachment)}</span><small>{attachment.kind === 'lecture-note' ? '课程笔记' : attachment.kind === 'material' ? '课件' : formatFileSize(attachment.size)}</small></span>
    {safeAttachmentURL(attachment.url) && <a className="attachment-icon-button" href={safeAttachmentURL(attachment.url)} download={displayAttachmentName(attachment)} aria-label={`下载 ${displayAttachmentName(attachment)}`}><Download size={15} /></a>}
  </div>)}</div>;
}

export function AttachmentPicker({ attachments = [], onChange, personaId = '' }) {
  const fileInput = useRef(null);
  const attachmentsRef = useRef(attachments);
  const onChangeRef = useRef(onChange);
  const files = useRef(new Map());
  const requests = useRef(new Map());
  const localPreviews = useRef(new Set());
  const [dragging, setDragging] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [selectionError, setSelectionError] = useState('');
  const closeSource = useCallback(() => setSourceOpen(false), []);
  attachmentsRef.current = attachments;
  onChangeRef.current = onChange;
  const commit = (update) => {
    const next = update(attachmentsRef.current);
    attachmentsRef.current = next;
    onChangeRef.current(next);
  };
  const patch = (localId, changes) => commit((items) => items.map((item) => item.localId === localId ? { ...item, ...changes } : item));

  const upload = async (localId, file) => {
    if (file.size > MAX_FILE_BYTES) {
      patch(localId, { status: 'error', error: '超过单文件 100 MB 限制，请选择较小的文件。' });
      return;
    }
    const controller = new AbortController();
    requests.current.set(localId, controller);
    patch(localId, { status: 'uploading', error: '' });
    try {
      const response = await fetch(`/api/attachments/upload?name=${encodeURIComponent(file.name)}`, {
        method: 'POST', body: file, signal: controller.signal,
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.attachment?.id) throw new Error(result.error || result.message || `上传失败（${response.status}）`);
      patch(localId, { ...result.attachment, localId, status: 'ready', error: '', restoring: false });
      files.current.delete(localId);
    } catch (error) {
      if (!controller.signal.aborted) patch(localId, { status: 'error', error: error.message || '上传失败，请重试。' });
    } finally {
      if (requests.current.get(localId) === controller) requests.current.delete(localId);
    }
  };
  const loadSaved = async (item) => {
    const controller = new AbortController();
    requests.current.set(item.localId, controller);
    patch(item.localId, { status: 'uploading', error: '' });
    try {
      const response = await fetch(attachmentEndpoint(item.id), { signal: controller.signal });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.attachment?.id) throw new Error(result.error || '无法读取这个附件，请重试或移除。');
      patch(item.localId, { ...result.attachment, localId: item.localId, status: 'ready', error: '', restoring: false });
    } catch (error) {
      if (!controller.signal.aborted) patch(item.localId, { status: 'error', error: error.message, restoring: false });
    } finally {
      if (requests.current.get(item.localId) === controller) requests.current.delete(item.localId);
    }
  };
  useEffect(() => {
    for (const item of attachments) {
      if (item.restoring && item.id && !requests.current.has(item.localId)) loadSaved(item);
    }
  }, [attachments]);
  useEffect(() => () => {
    requests.current.forEach((controller) => controller.abort());
    requests.current.clear();
    localPreviews.current.forEach((url) => URL.revokeObjectURL(url));
    localPreviews.current.clear();
  }, []);

  const addFiles = (list) => {
    const selected = Array.from(list || []);
    if (!selected.length) return;
    if (attachmentsRef.current.length + selected.length > 20) { setSelectionError('每次最多添加20份资料，请移除部分资料后再添加。'); return; }
    setSelectionError('');
    const items = selected.map((file) => {
      const localId = crypto.randomUUID();
      files.current.set(localId, file);
      const localPreview = isRasterImage(file.type) ? URL.createObjectURL(file) : '';
      if (localPreview) localPreviews.current.add(localPreview);
      return { localId, name: file.name || '粘贴的图片.png', size: file.size, content_type: file.type || 'application/octet-stream', status: 'uploading', localPreview };
    });
    commit((current) => [...current, ...items]);
    items.forEach((item, index) => upload(item.localId, selected[index]));
  };
  const remove = (item) => {
    requests.current.get(item.localId)?.abort();
    requests.current.delete(item.localId);
    files.current.delete(item.localId);
    if (item.localPreview) { URL.revokeObjectURL(item.localPreview); localPreviews.current.delete(item.localPreview); }
    commit((items) => items.filter((current) => (current.localId || current.id) !== (item.localId || item.id)));
  };
  const retry = (item) => {
    const file = files.current.get(item.localId);
    if (file) upload(item.localId, file);
    else if (item.id) loadSaved(item);
  };
  return <div className={`attachment-picker${dragging ? ' is-dragging' : ''}`}
    onDragOver={(event) => { if (Array.from(event.dataTransfer.types).includes('Files')) { event.preventDefault(); setDragging(true); } }}
    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }}
    onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); }}
    onPaste={(event) => { const pasted = Array.from(event.clipboardData.files); if (pasted.length) { event.preventDefault(); addFiles(pasted); } }}>
    <input ref={fileInput} className="attachment-file-input" type="file" multiple aria-label="选择要添加的文件" onChange={(event) => { addFiles(event.target.files); event.target.value = ''; }} />
    <button type="button" className="attachment-add" onClick={() => setSourceOpen(true)} aria-haspopup="dialog" title="选择本地文件、课件或某节课的课程笔记"><Paperclip size={16} /> 添加文件</button>
    {selectionError && <p className="attachment-error-text" role="alert">{selectionError}</p>}
    {sourceOpen && <LearningSourceDialog personaId={personaId} onClose={closeSource} onLocal={() => fileInput.current?.click()} selectedIds={attachments.map((item) => String(item.id))} onAdd={(item) => commit((current) => current.some((a) => String(a.id) === String(item.id)) ? current : [...current, item])} />}
    {dragging && <span className="attachment-drop-hint">松开即可添加文件</span>}
    {attachments.length > 0 && <div className="attachment-list" aria-label="已添加的文件" aria-live="polite">{attachments.map((item) => <div className={`attachment-chip attachment-${item.status}`} key={item.localId || item.id}>
      <span className="attachment-visual"><FileVisual attachment={item} /></span>
      <span className="attachment-details"><span className="attachment-name" title={displayAttachmentName(item)}>{displayAttachmentName(item)}</span><small>{item.kind === 'lecture-note' ? '课程笔记' : item.kind === 'material' ? '课件' : formatFileSize(item.size)}<span className="attachment-status">{item.status === 'uploading' ? <><LoaderCircle size={11} className="attachment-spinner" />{item.restoring ? '读取中' : '上传中'}</> : item.status === 'error' ? '读取未完成' : <><Check size={11} />已添加</>}</span></small>{item.error && <span className="attachment-error-text" role="alert">{item.error}</span>}</span>
      {item.status === 'error' && (files.current.has(item.localId) || item.id) && <button type="button" className="attachment-icon-button" onClick={() => retry(item)} aria-label={`重试 ${displayAttachmentName(item)}`} title="重试"><RotateCw size={14} /></button>}
      {item.status === 'ready' && safeAttachmentURL(item.url) && <a className="attachment-icon-button" href={safeAttachmentURL(item.url)} download={displayAttachmentName(item)} aria-label={`下载 ${displayAttachmentName(item)}`}><Download size={14} /></a>}
      <button type="button" className="attachment-icon-button" onClick={() => remove(item)} aria-label={`移除 ${displayAttachmentName(item)}`} title="从当前问题移除"><X size={14} /></button>
    </div>)}</div>}
  </div>;
}

export default AttachmentPicker;
