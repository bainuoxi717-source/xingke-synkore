import { useEffect, useState } from 'react';
import { RefreshCw, Download, Trash2, ExternalLink, FileText } from 'lucide-react';
import { api } from '../api.js';

const fmtSize = (b) => {
  if (!b) return '—';
  if (b > 1048576) return (b / 1048576).toFixed(1) + ' MB';
  return Math.round(b / 1024) + ' KB';
};
const iconFor = (name) => {
  const e = (name.split('.').pop() || '').toLowerCase();
  if (e === 'pdf') return '📕';
  if (e === 'ppt' || e === 'pptx') return '📊';
  if (e === 'doc' || e === 'docx') return '📄';
  if (e === 'xls' || e === 'xlsx') return '📈';
  return '📎';
};

export default function Materials() {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);

  const load = () => api.get('/materials').then(setItems).catch(() => setItems([]));
  useEffect(() => { load(); }, []);

  const sync = async () => {
    setBusy('sync');
    setMsg(null);
    try {
      const r = await api.post('/canvas/sync/files');
      const detail = (r.perCourse ?? [])
        .filter((c) => c.files > 0 || c.error)
        .map((c) => `${c.course} ${c.error ? `(${c.error})` : `×${c.files}`}`)
        .join('、');
      setMsg({
        ok: true,
        text: `同步完成：新增 ${r.added} 个、更新 ${r.updated} 个${r.skipped ? `，跳过 ${r.skipped} 个非文档` : ''}${detail ? `　—　${detail}` : ''}`,
      });
      load();
    } catch (e) {
      setMsg({ ok: false, text: '同步失败：' + e.message });
    } finally {
      setBusy('');
    }
  };

  const download = async (m) => {
    setBusy(m.id);
    setMsg(null);
    try {
      await api.post(`/materials/${m.id}/download`);
      await load();
      setMsg({ ok: true, text: `已下载到本地：${m.name}` });
    } catch (e) {
      setMsg({ ok: false, text: '下载失败：' + e.message });
    } finally {
      setBusy('');
    }
  };

  const remove = async (m) => {
    if (!window.confirm(`删除「${m.name}」？`)) return;
    await api.del(`/materials/${m.id}`);
    load();
  };

  const groups = [];
  for (const m of items) {
    const key = m.course_name || '未关联课程';
    let g = groups.find((x) => x.name === key);
    if (!g) { g = { name: key, color: m.course_color, list: [] }; groups.push(g); }
    g.list.push(m);
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
        <button className="btn primary" onClick={sync} disabled={busy === 'sync'}>
          <RefreshCw size={15} /> {busy === 'sync' ? '同步中…' : '同步 Canvas 课件'}
        </button>
        <span className="item-meta">共 {items.length} 份资料 · {groups.length} 门课程</span>
      </div>

      {msg && (
        <div className="section-note" style={msg.ok ? { borderColor: 'var(--ok)' } : { borderColor: 'var(--danger)' }}>
          {msg.text}
        </div>
      )}

      {items.length === 0 ? (
        <div className="empty">
          <div className="icon"><FileText size={30} style={{ color: 'var(--text-2)' }} /></div>
          <h3>还没有课程资料</h3>
          <p>
            点上方「同步 Canvas 课件」拉取老师上传的 PPT / PDF；<br />
            微信里收到的资料，直接发到对话里，我帮你存进这里。
          </p>
        </div>
      ) : (
        groups.map((g) => (
          <div className="card" key={g.name} style={{ marginBottom: 12 }}>
            <div className="card-title">
              <span className="dot" style={{ background: g.color || 'var(--accent)' }} />
              {g.name}
              <span style={{ color: 'var(--text-2)', fontWeight: 400, fontSize: 12 }}>（{g.list.length} 份）</span>
            </div>
            {g.list.map((m) => (
              <div className="item-row" key={m.id}>
                <span style={{ fontSize: 18, flexShrink: 0 }}>{iconFor(m.name)}</span>
                <div className="item-main">
                  <div className="item-title" style={{ fontSize: 13.5 }}>{m.name}</div>
                  <div className="item-meta">
                    <span className={`chip ${m.source === 'canvas' ? 'accent' : 'ok'}`}>
                      {m.source === 'canvas' ? 'Canvas' : m.source === 'wechat' ? '微信' : '手动'}
                    </span>
                    {m.size > 0 && <span>{fmtSize(m.size)}</span>}
                    {m.updated_at && <span>{new Date(m.updated_at).toLocaleDateString('zh-CN')}</span>}
                    {m.downloaded ? <span className="chip ok">已存本地</span> : <span className="chip gray">仅云端</span>}
                  </div>
                </div>
                {m.downloaded ? (
                  <a className="btn sm" href={`/api/materials/${m.id}/file`} target="_blank" rel="noreferrer">
                    <ExternalLink size={13} /> 打开
                  </a>
                ) : (
                  <button className="btn sm" onClick={() => download(m)} disabled={busy === m.id}>
                    <Download size={13} /> {busy === m.id ? '下载中' : '下载到本地'}
                  </button>
                )}
                <button className="btn ghost" title="删除" onClick={() => remove(m)}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
