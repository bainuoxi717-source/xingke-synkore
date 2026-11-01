import { useEffect, useRef, useState } from 'react';
import { Save, Link2 } from 'lucide-react';
import { api } from '../api.js';
import SjtuPanel from './SjtuPanel.jsx';
import { useSearchParams } from 'react-router-dom';
import { NAV_ITEMS } from '../modes.js';
import { displayCourse, redactShowcaseText, showcasePrivacy } from '../utils/showcasePrivacy.js';

export default function SettingsPage() {
  const [s, setS] = useState({});
  const [toast, setToast] = useState('');
  const [health, setHealth] = useState(null);
  const [saveState, setSaveState] = useState('idle');   // idle | saving | saved | error
  const dirtyRef = useRef(false);                        // 只有用户改动过才自动保存
  const timerRef = useRef(null);

  useEffect(() => { api.get('/settings').then(setS); }, []);

  // 自动保存：用户改动后 800ms 落地（不用再点保存）
  useEffect(() => {
    if (!dirtyRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    setSaveState('saving');
    timerRef.current = setTimeout(async () => {
      try {
        await api.put('/settings', s);
        dirtyRef.current = false;
        setSaveState('saved');
        setTimeout(() => setSaveState((v) => (v === 'saved' ? 'idle' : v)), 2500);
      } catch {
        setSaveState('error');
      }
    }, 800);
    return () => clearTimeout(timerRef.current);
  }, [s]);

  const save = async () => {
    try {
      await api.put('/settings', s);
      setSaveState('saved');
      setToast('设置已保存 ✅');
      setTimeout(() => setToast(''), 2000);
    } catch (e) {
      setToast('保存失败：' + e.message);
      setTimeout(() => setToast(''), 3000);
    }
  };

  const checkHealth = async () => {
    const h = await api.get('/health');
    setHealth(h);
  };

  const set = (k, v) => { dirtyRef.current = true; setS((prev) => ({ ...prev, [k]: v })); };

  const [params] = useSearchParams();
  const focusKey = params.get('focus') ?? '';

  // 课程老师修正（视频平台记的是排课教师，常与实际授课者不符）
  const [teacherList, setTeacherList] = useState([]);
  const [teacherDraft, setTeacherDraft] = useState({});
  const [savingTeacher, setSavingTeacher] = useState('');
  const [lanIps, setLanIps] = useState([]);
  // 老师音色
  const [voiceSt, setVoiceSt] = useState(null);
  const [voiceMsg, setVoiceMsg] = useState('');
  const [building, setBuilding] = useState('');
  const teacherAliases = new Map();
  let nextTeacherAlias = 1;
  for (const value of [...(voiceSt?.teachers || []).map((item) => item.teacher), ...teacherList.flatMap((item) => [item.lectureTeacher, item.courseTeacher])].filter(Boolean)) {
    if (teacherAliases.has(value)) continue;
    const alias = `教师 ${String(nextTeacherAlias++).padStart(2, '0')}`;
    teacherAliases.set(value, alias);
    for (const part of String(value).split(/[、,，;；/\s]+/).filter(Boolean)) if (!teacherAliases.has(part)) teacherAliases.set(part, alias);
  }
  const teacherLabel = (value) => showcasePrivacy ? teacherAliases.get(value) || '课程老师' : value;
  const privateText = (value) => {
    let text = String(value ?? '');
    if (showcasePrivacy) for (const [name, alias] of [...teacherAliases].sort((a, b) => b[0].length - a[0].length)) text = text.split(name).join(alias);
    return redactShowcaseText(text);
  };
  const loadVoice = () => api.get('/voices/status').then((r) => setVoiceSt(r)).catch(() => setVoiceSt(null));
  useEffect(() => { loadVoice(); }, []);
  const probeVoice = async () => {
    setVoiceMsg('探测中…');
    try {
      const r = await api.get('/voices/probe');
      if (!r.ok) { setVoiceMsg('探测失败：' + r.error); return; }
      const uf = (r.urlFields ?? []).map((x) => x.field).join(', ') || '无';
      const okCand = (r.candidates ?? []).filter((c) => c.ok && /\.mp4|\.m3u8/.test(c.sample)).length;
      setVoiceMsg(`录播列表字段 ${(r.listFields ?? []).length} 个；疑似地址字段：${uf}；候选播放接口命中 ${okCand} 个`);
    } catch (e) { setVoiceMsg('探测失败：' + e.message); }
  };
  const buildVoice = async (teacher, courId) => {
    setBuilding(teacher);
    setVoiceMsg(`正在为「${teacher}」从课堂录播截取语音并克隆（约 20-40 秒）…`);
    try {
      const r = await api.post('/voices/build', { teacher, courId });
      setVoiceMsg(`✅ ${r.teacher} 音色克隆成功（样本 ${r.seconds}s，来源：${r.source}）`);
      await loadVoice();
    } catch (e) {
      setVoiceMsg(`❌ ${teacher} 克隆失败：${e.message}`);
      await loadVoice();
    } finally { setBuilding(''); }
  };
  // 从本地音频文件克隆（30~60 秒即可，不必用整段录播）
  const uploadVoice = async (teacher, file) => {
    if (!file) return;
    setBuilding(teacher);
    setVoiceMsg(`正在上传「${file.name}」并克隆「${teacher}」…`);
    try {
      const b64 = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result));
        fr.onerror = () => rej(new Error('读取文件失败'));
        fr.readAsDataURL(file);
      });
      const r = await api.post('/voices/build', { teacher, audioBase64: b64, audioName: file.name });
      setVoiceMsg(`✅ ${r.teacher} 音色克隆成功（样本 ${r.seconds}s，来源：${r.source}）`);
      await loadVoice();
    } catch (e) {
      setVoiceMsg(`❌ ${teacher} 克隆失败：${e.message}`);
      await loadVoice();
    } finally { setBuilding(''); }
  };

  const delVoice = async (teacher) => {
    if (!confirm(`删除「${teacherLabel(teacher)}」的音色？`)) return;
    await api.del('/voices/' + encodeURIComponent(teacher)).catch(() => {});
    setVoiceMsg(`已删除「${teacher}」的音色`);
    await loadVoice();
  };
  useEffect(() => {
    api.get('/lan-info').then((r) => setLanIps(r.ips ?? [])).catch(() => setLanIps([]));
  }, []);
  useEffect(() => { api.get('/lecture-teachers').then((r) => setTeacherList(r.items ?? [])).catch(() => {}); }, []);
  const saveTeacher = async (subjName) => {
    const teacher = (teacherDraft[subjName] ?? '').trim();
    if (!teacher) return;
    setSavingTeacher(subjName);
    try {
      const r = await api.post('/lectures/teacher', { subjName, teacher });
      setTeacherList((list) => list.map((x) => (x.subjName === subjName ? { ...x, lectureTeacher: r.after } : x)));
      setToast(`✅ ${subjName} 的老师已改为「${r.after}」，问答范围已更新`);
      setTimeout(() => setToast(''), 3000);
    } catch (e) {
      setToast('保存失败：' + e.message);
      setTimeout(() => setToast(''), 3000);
    } finally { setSavingTeacher(''); }
  };

  const SAVE_TEXT = {
    idle: '',
    saving: '自动保存中…',
    saved: '已自动保存 ✅',
    error: '⚠️ 自动保存失败，请点右下角「保存设置」',
  }[saveState];

  return (
    <div style={{ maxWidth: 760 }}>
      <div className="page-head">
        <div>
          <div className="page-title">导入与设置</div>
          <div className="page-sub">配置数据源。所有信息只保存在你本机。<b>改动会自动保存。</b></div>
        </div>
        <span className={`chip ${saveState === 'saved' ? 'ok' : saveState === 'error' ? 'danger' : 'gray'}`} style={{ minWidth: 96, justifyContent: 'center' }}>
          {SAVE_TEXT || '自动保存已开启'}
        </span>
      </div>

      <SjtuPanel settings={s} onChange={set} focusKey={focusKey} />

      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-title">📥 手动数据导入（备选方案）</div>
        <div className="section-note">
          Cookie 接入配好后就不用这个了。备用：把文件放到文件夹 <b>数据导入</b>（在工作台目录旁），或直接发到对话里：<br />
          ① 课表（Excel/PDF/截图，Excel 可在「我的课表」页直接上传）　② 培养计划（PDF/截图）　③ 课程视频字幕（SRT/VTT）
        </div>
      </div>

      <div className="card">
        <div className="card-title"><Link2 size={15} color="var(--accent)" /> Canvas 令牌（可选，交大直接填 Cookie 即可）</div>
        <label>Canvas 网址</label>
        <input value={s.canvasUrl ?? ''} onChange={(e) => set('canvasUrl', e.target.value)} placeholder="https://oc.sjtu.edu.cn（交大默认，可留空）" />
        <label>API 访问令牌（Canvas → 账户 → 设置 → 已批准的集成 → 新建访问令牌）</label>
        <input type="password" value={s.canvasToken ?? ''} onChange={(e) => set('canvasToken', e.target.value)} placeholder="粘贴令牌（与 Cookie 二选一）" />
      </div>

      <div className="card">
        <div className="card-title">🎛️ 导航栏目（深度学习模块）</div>
        <div className="section-note">
          本开发包只包含深度学习模块，栏目固定如下。想加新栏目：
          ① 在 <code>web/src/modes.js</code> 的 NAV_ITEMS 加一行
          ② 在 <code>web/src/App.jsx</code> 加一条 &lt;Route&gt;
          ③ 在 <code>server/src/index.js</code> 加对应 API
        </div>
        {NAV_ITEMS.map((it) => (
          <div className="mode-cfg-row" key={it.to}>
            <span>{it.label}</span>
            {it.hint && <span className="chip gray">{it.hint}</span>}
            <div className="mode-cfg-seg"><span className="chip ok">{it.to}</span></div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-title">🎙 老师音色克隆（朗读用老师本人的声音）</div>
        <div className="section-note">
          从课堂录播里截取老师讲话片段 → 克隆成音色 → 之后「朗读」答案就用这位老师的声音。
          需要 <b>MiniMax</b> 的 API Key（中文音色质量好，按量计费，克隆+合成都很便宜）。
        </div>
        <label>启用老师音色</label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400 }}>
          <input type="checkbox" checked={!!s.voiceEnabled} onChange={(e) => set('voiceEnabled', e.target.checked)} />
          开启后，问答页的「朗读」优先用克隆音色（没克隆的老师自动回退到系统语音）
        </label>
        <label style={{ marginTop: 10 }}>MiniMax API Key</label>
        <input type="password" value={s.minimaxKey ?? ''} onChange={(e) => set('minimaxKey', e.target.value)} placeholder="填写后即可克隆与合成" />
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <button className="btn sm" onClick={loadVoice}>刷新状态</button>
          <button className="btn sm" onClick={probeVoice}>探测课堂音频接口</button>
        </div>
        {voiceMsg && <div className="section-note" style={{ marginTop: 8, color: 'var(--accent)' }}>{privateText(voiceMsg)}</div>}
        {voiceSt && (
          <>
            <div className="section-note" style={{ marginTop: 8 }}>
              ffmpeg：{voiceSt.ffmpeg ? '✅ 就绪' : '❌ 未安装'} · 已克隆音色：{voiceSt.ready} / {voiceSt.teachers?.length ?? 0} 位
            </div>
            {(voiceSt.teachers ?? []).map((x) => (
              <div className="teacher-row" key={x.teacher}>
                <div className="teacher-name">{teacherLabel(x.teacher)}<span className="chip gray">{x.lectures} 节</span></div>
                {x.hasVoice
                  ? <span className="chip ok">已克隆 {x.sampleSeconds ? `· ${x.sampleSeconds}s` : ''}</span>
                  : <span className="chip gray">{x.status === 'error' ? '失败' : '未克隆'}</span>}
                {x.error && <span className="chip warn" title={privateText(x.error)}>⚠️</span>}
                <div className="mode-cfg-seg">
                  <button className="btn sm" disabled={building === x.teacher || !x.sampleCourId}
                    title={x.sampleCourId ? '从课堂录播自动截取 90 秒' : '这位老师还没有足够长的课堂字幕'}
                    onClick={() => buildVoice(x.teacher, x.sampleCourId)}>
                    {building === x.teacher ? '克隆中…' : (x.hasVoice ? '重新克隆' : '自动克隆')}
                  </button>
                  <label className="btn sm" style={{ cursor: 'pointer', margin: 0 }}>
                    上传音频
                    <input type="file" accept="audio/*,video/*" style={{ display: 'none' }}
                      onChange={(e) => { uploadVoice(x.teacher, e.target.files?.[0]); e.target.value = ''; }} />
                  </label>
                  {x.hasVoice && <button className="btn sm" onClick={() => delVoice(x.teacher)}>删除</button>}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
      <div className="card">
        <div className="card-title">🌐 局域网访问（把本机当服务器）</div>
        <div className="section-note">
          工作台已监听所有网卡，同一网络下的手机/平板/其他电脑可以直接访问。
          <b>本机（localhost）永远免密</b>；其他设备访问需要下面的密码。
        </div>
        <label>访问密码</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={s.accessPassword ?? ''}
            onChange={(e) => set('accessPassword', e.target.value)}
            placeholder="留空 = 不设密码（仅建议在本机使用）"
            style={{ flex: 1 }}
          />
          <button
            className="btn sm"
            onClick={() => {
              const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
              let p = '';
              for (let i = 0; i < 12; i++) p += chars[Math.floor(Math.random() * chars.length)];
              set('accessPassword', p);
            }}
          >
            随机生成
          </button>
        </div>
        <div className="section-note" style={{ marginTop: 8 }}>
          访问地址（从其他设备打开）：<br />
          {lanIps.map((ip) => (
            <code key={ip} style={{ display: 'inline-block', marginRight: 10 }}>http://{ip}:3910</code>
          ))}
          <br />
          <span style={{ color: 'var(--warn)' }}>⚠️ 首次局域网访问若失败，需要管理员权限放行防火墙（见说明文档）</span>
        </div>
      </div>
      <div className="card">
        <div className="card-title">👩‍🏫 课程老师修正</div>
        <div className="section-note">
          视频平台记录的是<b>排课教师</b>，常与实际上课的老师不符（也会影响「用老师的口吻回答」）。
          发现不对就在这里改 —— 问答范围、引用出处、老师画像都会跟着更新。
        </div>
        {teacherList.length === 0 && <div className="item-meta">加载中…</div>}
        {teacherList.map((x) => (
          <div className="teacher-row" key={x.subjName}>
            <div className="teacher-name">
              {displayCourse(x.subjName)}
              <span className="chip gray">{x.lectures} 节</span>
            </div>
            <input
              type={showcasePrivacy ? 'password' : 'text'}
              autoComplete="off"
              aria-label={`${displayCourse(x.subjName)}实际授课老师`}
              value={teacherDraft[x.subjName] ?? x.lectureTeacher}
              onChange={(e) => setTeacherDraft((d) => ({ ...d, [x.subjName]: e.target.value }))}
              placeholder="实际授课老师"
            />
            {x.differs && <span className="chip warn" title={`教务记录：${teacherLabel(x.courseTeacher)}`}>教务记的是「{teacherLabel(x.courseTeacher)}」</span>}
            <button
              className="btn sm"
              disabled={savingTeacher === x.subjName || (teacherDraft[x.subjName] ?? x.lectureTeacher) === x.lectureTeacher}
              onClick={() => saveTeacher(x.subjName)}
            >
              {savingTeacher === x.subjName ? '保存中…' : '保存'}
            </button>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-title">🤖 AI 能力（DeepSeek API）</div>
        <label>DeepSeek API Key</label>
        <input type="password" value={s.deepseekKey ?? ''} onChange={(e) => set('deepseekKey', e.target.value)} placeholder="sk-..." />
        <label>模型</label>
        <select value={s.aiModel ?? 'deepseek-v4-flash'} onChange={(e) => set('aiModel', e.target.value)}>
          <option value="deepseek-v4-flash">deepseek-v4-flash · 快速省钱（推荐，1M 上下文）</option>
          <option value="deepseek-v4-pro">deepseek-v4-pro · 更强推理（贵一些）</option>
        </select>
        <div className="section-note">
          用于「学习问答」「视频内化」「学习计划」等 AI 功能。在 platform.deepseek.com 申请，按用量计费。<br />
          工作台已针对 v4 系列优化：问答与自测题关闭思考模式（省约 80% token），笔记整理保留思考以提升质量。
        </div>
      </div>

      <div className="card">
        <div className="card-title">🏫 基础信息</div>
        <div className="form-grid">
          <div>
            <label>学校名称</label>
            <input value={s.schoolName ?? ''} onChange={(e) => set('schoolName', e.target.value)} placeholder="上海交通大学" />
          </div>
          <div>
            <label>当前学期</label>
            <input value={s.termName ?? ''} onChange={(e) => set('termName', e.target.value)} placeholder="例如 2026 秋季学期" />
          </div>
          <div>
            <label>开学第 1 周周一日期</label>
            <input type="date" value={s.termStart ?? ''} onChange={(e) => set('termStart', e.target.value)} />
          </div>
          <div>
            <label>学期总周数</label>
            <input type="number" value={s.termWeeks ?? ''} onChange={(e) => set('termWeeks', e.target.value)} placeholder="例如 18" />
          </div>
        </div>
        <div className="section-note">填写「开学第 1 周周一」后，课表和计划才能自动识别「本周是第几周」（含单双周课程）。</div>
      </div>

      <div style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'center' }}>
        <button className="btn primary" onClick={save}><Save size={15} /> 保存设置</button>
        <button className="btn" onClick={checkHealth}>检查后端连接</button>
        {health && <span className="chip ok">后端正常 · v{health.version}</span>}
      </div>

      {toast && <div className="toast">{privateText(toast)}</div>}
    </div>
  );
}
