import { useEffect, useState } from 'react';
import { Upload, Sparkles, Trash2, FileText } from 'lucide-react';
import { api } from '../api.js';

const STATUS_LABEL = {
  uploaded: { text: '已上传（待转写）', cls: 'warn' },
  transcribed: { text: '已转写', cls: 'accent' },
  internalized: { text: '已内化 ✅', cls: 'ok' },
};

function readFileBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1]);
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

export default function Videos() {
  const [videos, setVideos] = useState([]);
  const [courses, setCourses] = useState([]);
  const [vod, setVod] = useState(null);
  const [vodBusy, setVodBusy] = useState('');
  const [current, setCurrent] = useState(null);
  const [form, setForm] = useState({ title: '', course_id: '' });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  const load = () => Promise.all([api.get('/videos'), api.get('/courses')])
    .then(([v, c]) => { setVideos(v); setCourses(c); });
  useEffect(() => {
    load();
    api.get('/video/status').then(setVod).catch(() => setVod({ ok: false }));
  }, []);

  // 连接视频空间（走 Canvas LTI 链拿权限）
  const connectVideo = async () => {
    setVodBusy('connect');
    try {
      const r = await api.post('/video/connect');
      if (!r.ok) { setToast('连接失败：' + r.error); return; }
      const list = await api.get('/video/courses');
      setVod({ ok: true, hasToken: true, valid: true, courses: list.courses, count: list.count });
      setToast(`视频空间已连接 ✅ 读取到 ${list.count} 门课的录播`);
    } catch (e) {
      setToast('连接失败：' + e.message);
    } finally { setVodBusy(''); setTimeout(() => setToast(''), 4000); }
  };

  const loadVodCourses = async () => {
    setVodBusy('list');
    try {
      const list = await api.get('/video/courses');
      setVod((s) => ({ ...(s ?? {}), ok: true, courses: list.courses, count: list.count }));
      setToast(`已读取 ${list.count} 门课的录播信息`);
    } catch (e) {
      setToast('读取失败：' + e.message);
    } finally { setVodBusy(''); setTimeout(() => setToast(''), 3000); }
  };

  const notify = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2600); };

  const upload = async (e) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    try {
      const b64 = await readFileBase64(file);
      const v = await api.post('/videos', { title: form.title, course_id: form.course_id, fileName: file.name, dataBase64: b64 });
      notify('上传成功，文字稿已转写 ✨');
      setForm({ title: '', course_id: '' });
      setFile(null);
      load();
      setCurrent(v);
    } catch (err) {
      notify('上传失败：' + err.message);
    } finally {
      setBusy(false);
    }
  };

  const internalize = async () => {
    if (!current) return;
    setBusy(true);
    try {
      const r = await api.post(`/videos/${current.id}/internalize`);
      notify('内化完成：笔记 + 自测题已生成 🎉');
      load();
      setCurrent({ ...current, summary: r.summary, quiz: JSON.stringify(r.quiz), status: 'internalized' });
    } catch (err) {
      notify('内化失败：' + err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm('删除这条视频记录？')) return;
    await api.del(`/videos/${id}`);
    if (current?.id === id) setCurrent(null);
    load();
  };

  let quiz = [];
  if (current?.quiz) {
    try { quiz = JSON.parse(current.quiz); } catch { quiz = []; }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">视频自动学习内化</div>
          <div className="page-sub">从视频空间读取你真实参与的课堂录播与 PPT，AI 提炼笔记与自测题</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14, borderColor: vod?.hasToken ? 'var(--ok)' : undefined }}>
        <div className="card-title">
          🎥 视频空间录播（我参与的课堂）
          {vod?.valid && <span className="chip ok" style={{ marginLeft: 6 }}>已连接</span>}
          <button className="btn sm" style={{ marginLeft: 8 }} onClick={connectVideo} disabled={vodBusy === 'connect'}>
            {vodBusy === 'connect' ? '连接中…' : vod?.valid ? '重新连接' : '连接视频空间'}
          </button>
          {vod?.valid && (
            <button className="btn sm" onClick={loadVodCourses} disabled={vodBusy === 'list'}>
              {vodBusy === 'list' ? '读取中…' : '读取录播列表'}
            </button>
          )}
        </div>
        {vod?.courses?.length > 0 ? (
          <>
            <div className="item-meta" style={{ marginBottom: 8 }}>
              <span className="chip accent">共 {vod.count} 门课</span>
              <span className="chip gray">
                合计 {vod.courses.reduce((s, c) => s + c.lectureCount, 0)} 个课次 · {vod.courses.reduce((s, c) => s + c.pptSlices, 0)} 个 PPT 切片
              </span>
            </div>
            {vod.courses.map((c) => (
              <div className="item-row" key={c.teclId}>
                <div className="item-main">
                  <div className="item-title" style={{ fontSize: 13.5 }}>{c.subjName} <span style={{ color: 'var(--text-2)', fontWeight: 400 }}>[{c.subjCode}]</span></div>
                  <div className="item-meta">
                    <span className="chip course">{c.teachers || '—'}</span>
                    <span>{c.lectureCount} 课次</span>
                    <span>{c.pptSlices} 个 PPT 切片</span>
                    {c.room && <span>@{c.room}</span>}
                    {c.playCount > 0 && <span>播放 {c.playCount}</span>}
                  </div>
                </div>
              </div>
            ))}
          </>
        ) : (
          <div className="section-note">
            点「连接视频空间」→ 自动走 Canvas LTI 授权 → 读取你**真实参与的课堂录播**（含课次数与 PPT 切片段数）。
            <br />权限有效约 24 小时，过期后重新点一下即可（依赖 Canvas Cookie）。
          </div>
        )}
      </div>

      <form className="card" onSubmit={upload}>
        <div className="card-title"><Upload size={15} color="var(--accent)" /> 上传字幕 / 文字稿</div>
        <div className="form-grid">
          <div>
            <label>标题</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="例如：高数第三章 导数的应用" />
          </div>
          <div>
            <label>所属课程</label>
            <select value={form.course_id} onChange={(e) => setForm({ ...form, course_id: e.target.value })}>
              <option value="">（未关联）</option>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="full">
            <label>文件（SRT / VTT / TXT 字幕或文字稿）</label>
            <input
              type="file"
              accept=".srt,.vtt,.txt,.md"
              onChange={(e) => {
                const f = e.target.files?.[0];
                setFile(f);
                if (f && !form.title) setForm((s) => ({ ...s, title: f.name.replace(/\.[^.]+$/, '') }));
              }}
            />
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <button type="submit" className="btn primary" disabled={!file || busy}>上传并转写</button>
        </div>
        <div className="section-note">
          <b>字幕从哪来？</b> Canvas 录像（Panopto/Studio）、学习通、雨课堂、智慧树、B 站课程页都提供「下载字幕」。
          找到后把 .srt/.vtt 文件传上来即可。若平台没有字幕，把录播视频文件发到对话里，我用转写管线处理。
        </div>
      </form>

      <div className="videos-layout">
        <div className="card videos-list">
          <div className="card-title">视频库（{videos.length}）</div>
          {videos.length === 0 && (
            <div className="empty" style={{ border: 'none' }}>
              <div className="icon"><FileText size={28} style={{ color: 'var(--text-2)' }} /></div>
              <p>还没有上传任何视频字幕</p>
            </div>
          )}
          {videos.map((v) => (
            <div key={v.id} className={`notes-item${current?.id === v.id ? ' active' : ''}`} onClick={() => setCurrent(v)}>
              <div className="item-title" style={{ fontSize: 13.5 }}>{v.title}</div>
              <div className="item-meta">
                {v.course_name && <span className="chip course" style={{ '--c': v.course_color }}>{v.course_name}</span>}
                <span className={`chip ${STATUS_LABEL[v.status]?.cls || 'gray'}`}>{STATUS_LABEL[v.status]?.text || v.status}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="card videos-detail">
          {!current ? (
            <div className="empty" style={{ border: 'none' }}>
              <div className="icon">🎬</div>
              <h3>选择一个视频</h3>
              <p>上传字幕后，这里会显示转写结果和 AI 生成的笔记、自测题。</p>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ fontSize: 16 }}>{current.title}</h3>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn primary sm" onClick={internalize} disabled={busy || !current.transcript}>
                    <Sparkles size={14} /> AI 内化
                  </button>
                  <button className="btn ghost" onClick={() => remove(current.id)}><Trash2 size={15} /></button>
                </div>
              </div>
              <div className="item-meta" style={{ margin: '6px 0 12px' }}>
                <span className={`chip ${STATUS_LABEL[current.status]?.cls || 'gray'}`}>{STATUS_LABEL[current.status]?.text || current.status}</span>
                {current.transcript && <span className="chip gray">文字稿 {current.transcript.length} 字</span>}
              </div>

              {!current.transcript && (
                <div className="section-note">这是音视频文件（未转写）。目前请优先上传字幕文件；完整转写管线即将上线。</div>
              )}

              {current.summary && (
                <>
                  <div className="card-title" style={{ marginTop: 10 }}>📝 AI 结构化笔记</div>
                  <div className="md-view">{current.summary.split('\n').map((l, i) => <div key={i}>{l}</div>)}</div>
                </>
              )}

              {quiz.length > 0 && (
                <>
                  <div className="card-title" style={{ marginTop: 12 }}>🧠 自测题（{quiz.length} 道）</div>
                  {quiz.map((q, i) => (
                    <details key={i} className="quiz-item">
                      <summary>{i + 1}. {q.q}</summary>
                      <div className="quiz-answer">{q.a}</div>
                    </details>
                  ))}
                </>
              )}

              {current.transcript && (
                <>
                  <div className="card-title" style={{ marginTop: 12 }}>📄 文字稿</div>
                  <details>
                    <summary style={{ cursor: 'pointer', color: 'var(--text-2)' }}>展开文字稿（{current.transcript.length} 字）</summary>
                    <div className="transcript-view">{current.transcript}</div>
                  </details>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
