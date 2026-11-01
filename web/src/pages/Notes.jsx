import { useEffect, useState } from 'react';
import { Plus, Save, Trash2, FileText, FolderOpen, NotebookPen } from 'lucide-react';
import { api } from '../api.js';
import Materials from './Materials.jsx';

export default function Notes() {
  const [notes, setNotes] = useState([]);
  const [courses, setCourses] = useState([]);
  const [tab, setTab] = useState(() =>
    new URLSearchParams(window.location.search).get('tab') === 'materials' ? 'materials' : 'notes'
  );
  const [current, setCurrent] = useState(null); // 正在编辑的笔记
  const [form, setForm] = useState({ title: '', content: '', tags: '', course_id: '' });
  const [toast, setToast] = useState('');

  const load = () => Promise.all([api.get('/notes'), api.get('/courses')])
    .then(([n, c]) => { setNotes(n); setCourses(c); });
  useEffect(() => { load(); }, []);

  const openNew = () => {
    setCurrent(null);
    setForm({ title: '', content: '', tags: '', course_id: '' });
  };

  const openNote = (n) => {
    setCurrent(n);
    setForm({ title: n.title, content: n.content, tags: n.tags, course_id: n.course_id ?? '' });
  };

  const save = async () => {
    if (!form.title.trim()) return;
    if (current) {
      await api.put(`/notes/${current.id}`, form);
      setToast('笔记已保存');
    } else {
      await api.post('/notes', form);
      setToast('笔记已创建');
    }
    setTimeout(() => setToast(''), 1800);
    load();
  };

  const remove = async (id) => {
    if (!window.confirm('确定删除这条笔记？')) return;
    await api.del(`/notes/${id}`);
    if (current?.id === id) openNew();
    load();
  };

  const fmtDate = (iso) => {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">资料笔记</div>
          <div className="page-sub">
            {tab === 'notes' ? '按课程整理笔记，复习时快速定位' : '老师上传的课件 + 微信收到的资料，都收在这里'}
          </div>
        </div>
        {tab === 'notes' && (
          <button className="btn primary" onClick={openNew}><Plus size={15} /> 新建笔记</button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button className={`btn ${tab === 'notes' ? 'primary' : ''}`} onClick={() => setTab('notes')}>
          <NotebookPen size={15} /> 我的笔记（{notes.length}）
        </button>
        <button className={`btn ${tab === 'materials' ? 'primary' : ''}`} onClick={() => setTab('materials')}>
          <FolderOpen size={15} /> 课程资料
        </button>
      </div>

      {tab === 'materials' ? (
        <Materials />
      ) : (
      <div className="notes-layout">
        <div className="card notes-list">
          {notes.length === 0 && (
            <div className="empty" style={{ border: 'none' }}>
              <div className="icon"><FileText size={30} style={{ color: 'var(--text-2)' }} /></div>
              <p>还没有笔记。点「新建笔记」开始，或等「视频内化」功能自动生成。</p>
            </div>
          )}
          {notes.map((n) => (
            <div
              key={n.id}
              className={`notes-item${current?.id === n.id ? ' active' : ''}`}
              onClick={() => openNote(n)}
            >
              <div className="item-title" style={{ fontSize: 13.5 }}>{n.title}</div>
              <div className="item-meta">
                {n.course_name && <span className="chip course" style={{ '--c': n.course_color }}>{n.course_name}</span>}
                <span>{fmtDate(n.updated_at)}</span>
                {n.tags && <span>🏷 {n.tags}</span>}
              </div>
            </div>
          ))}
        </div>

        <div className="card notes-editor">
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="笔记标题"
            style={{ fontSize: 17, fontWeight: 700, border: 'none', padding: '4px 0', boxShadow: 'none' }}
          />
          <div className="form-grid" style={{ marginTop: 6 }}>
            <div>
              <label>所属课程</label>
              <select value={form.course_id} onChange={(e) => setForm({ ...form, course_id: e.target.value })}>
                <option value="">（未关联）</option>
                {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label>标签（逗号分隔）</label>
              <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="如：重点, 易错" />
            </div>
          </div>
          <label style={{ marginTop: 12 }}>内容</label>
          <textarea
            rows={16}
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
            placeholder={'在这里写笔记…\n\n支持纯文本。后续会接入 AI：粘贴课件文字即可自动整理成结构化笔记。'}
          />
          <div style={{ marginTop: 12, display: 'flex', gap: 10, justifyContent: 'space-between' }}>
            <button className="btn primary" onClick={save}><Save size={15} /> 保存</button>
            {current && (
              <button className="btn danger" onClick={() => remove(current.id)}><Trash2 size={15} /> 删除</button>
            )}
          </div>
        </div>
      </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
