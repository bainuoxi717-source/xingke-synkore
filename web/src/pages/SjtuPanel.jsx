import { useEffect, useState } from 'react';
import { Plug, RefreshCw, CalendarDays, GraduationCap, CheckCircle2, Target, FileCheck, FolderOpen, Globe, Power, ExternalLink } from 'lucide-react';
import { api } from '../api.js';

// 上海交通大学系统接入面板：Cookie 鉴权 + 一键同步
export default function SjtuPanel({ settings, onChange, toast, focusKey = '' }) {
  const [busy, setBusy] = useState(null); // 正在执行的操作名
  const [result, setResult] = useState(null); // { ok, text }
  const [curlText, setCurlText] = useState('');
  const [curlMsg, setCurlMsg] = useState(null);

  const set = (k, v) => onChange(k, v);

  // 从 cURL / 请求头一键提取 Cookie 并填入对应系统
  const extractCookie = async () => {
    setCurlMsg(null);
    setBusy('extract');
    try {
      const r = await api.post('/sjtu/extract-cookie', { text: curlText });
      if (r.hostKey) {
        set(`cookie_${r.hostKey}`, r.cookie);
        setCurlMsg({ ok: true, text: `已识别为「${r.hostLabel}」并自动填入（Cookie 长度 ${r.length}）✅` });
      } else {
        setCurlMsg({ ok: false, text: '提取到 Cookie 了，但没识别出属于哪套系统。请把 cURL 里的网址（如 https://i.sjtu.edu.cn/...）一起复制进来。' });
      }
      setCurlText('');
    } catch (e) {
      setCurlMsg({ ok: false, text: e.message || '提取失败' });
    } finally {
      setBusy(null);
    }
  };

  const run = async (label, fn) => {
    setBusy(label);
    setResult(null);
    try {
      await api.put('/settings', settings); // 先保存当前配置再执行
      const r = await fn();
      if (r.ok === false) {
        setResult({ ok: false, text: r.error || '操作失败' });
      } else {
        let text = '';
        if (label === 'status') {
          const e = r.my?.entities?.[0] ?? {};
          const unread = r.unread?.total;
          text = [
            '连接成功 ✅',
            e.name ? `你好，${e.name}` : '',
            e.code ? `学号 ${e.code}` : '',
            e.organize?.name || '',
            unread != null ? `教务消息未读 ${unread} 条` : '',
          ].filter(Boolean).join(' · ');
        } else if (label === 'schedule') {
          text = `课表同步成功 ✅ 课程 ${r.courses} 门 / 时段 ${r.slots} 个（新增课程 ${r.cAdded}，新增时段 ${r.sAdded}）`;
          if (r.warnings?.length) text += ` · ${r.warnings.length} 条跳过`;
        } else if (label === 'grades') {
          text = `成绩同步成功 ✅ 解析 ${r.parsed} 条（新增 ${r.gAdded}，更新 ${r.gUpdated}）`;
        } else if (label === 'progress') {
          text = `培养方案同步成功 ✅ ${r.entries} 条模块记录 → 毕业要求 ${r.totalRequired} 学分，已获 ${r.totalEarned} 学分`;
        } else if (label === 'exams') {
          text = r.total === 0
            ? `考试同步完成 ✅ ${r.message}`
            : `考试同步成功 ✅ 共 ${r.total} 场（新增 ${r.added}，更新 ${r.updated}），已按截止时间进入提醒`;
        } else if (label === 'canvas') {
          text = `Canvas 同步成功 ✅ 课程 ${r.courses} 门（新增 ${r.created}）· 作业新增 ${r.added} / 更新 ${r.updated}`;
        }
        setResult({ ok: true, text });
      }
    } catch (e) {
      setResult({ ok: false, text: e.message || '请求失败' });
    } finally {
      setBusy(null);
    }
  };

  const [browserMsg, setBrowserMsg] = useState(null);
  const [runningBrowser, setRunningBrowser] = useState('');

  // 检测浏览器是否在运行（决定是否显示「自动关闭」按钮）
  useEffect(() => {
    api.get('/sjtu/browser-profiles').then((r) => {
      const running = (r.profiles ?? []).find((p) => p.running);
      setRunningBrowser(running?.label ?? '');
    }).catch(() => {});
  }, []);

  const openLoginPages = async () => {
    setBusy('openLogin');
    try {
      const r = await api.post('/sjtu/open-login-pages', { browser: 'chrome' });
      setBrowserMsg(r.ok
        ? { ok: true, text: '✅ 已在 Chrome 打开 3 个登录页（Canvas / 教务 / 交我办）。请依次登录，然后点「② 登录好了，一键导入」。' }
        : { ok: false, text: r.error ?? '打开失败' });
    } catch (e) {
      setBrowserMsg({ ok: false, text: '打开失败：' + e.message });
    } finally { setBusy(null); }
  };

  // 专用浏览器会话（根治过期）：打开窗口 → 用户登录一次 → 随时自动取
  const [sess, setSess] = useState(null);
  const loadSession = () => api.get('/session/status').then(setSess).catch(() => setSess(null));
  useEffect(() => { loadSession(); }, []);

  const openSession = async () => {
    setBusy('sessionOpen');
    try {
      const r = await api.post('/session/open', {});
      setBrowserMsg({ ok: true, text: '✅ 已打开「工作台专用浏览器」窗口（与你的日常浏览器互不影响）。请在**那个窗口**里登录 Canvas / 教务 / 交我办，然后点「读取登录态」。' });
      await loadSession();
    } catch (e) { setBrowserMsg({ ok: false, text: '打开失败：' + e.message }); }
    finally { setBusy(null); }
  };

  const pullSession = async () => {
    setBusy('sessionPull');
    try {
      const r = await api.post('/session/pull', {});
      if (r.ok) {
        Object.entries(r.saved ? {} : {}).forEach(() => {});
        setBrowserMsg({ ok: true, text: '✅ 已从专用浏览器读取并保存登录态：' + r.found.map((x) => x.name + '(' + x.cookies + '条)').join('、') + '。正在刷新数据…' });
        const rr = await api.post('/refresh', { force: true, reason: 'after-session-pull' });
        const bad = (rr.failed ?? []).map((x) => x.label);
        setBrowserMsg({ ok: true, text: '✅ 登录态已保存并刷新数据' + (bad.length ? '（' + bad.join('、') + ' 仍失败）' : '：全部成功 🎉') });
      } else {
        setBrowserMsg({ ok: false, text: r.hint || '专用浏览器里还没有登录态' });
      }
    } catch (e) { setBrowserMsg({ ok: false, text: '读取失败：' + e.message }); }
    finally { setBusy(null); }
  };
  const doBrowserImport = async (closeBrowser) => {
    setBusy('browserImport');
    setBrowserMsg(null);
    try {
      const r = await api.post('/sjtu/import-from-browser', { closeBrowser });
      if (!r.ok) {
        setBrowserMsg({ ok: false, text: r.error ?? '导入失败' });
        return;
      }
      const lines = (r.found ?? []).map((f) => `${f.name}(${f.cookies} 条)`).join('、');
      // 自动写入并刷新对应数据域（不用再点保存）
      Object.entries(r.fields ?? {}).forEach(([k, v]) => onChange?.(k, v));
      const domainMap = { cookie_i: ['jw'], cookie_my: ['my'], cookie_oc: ['canvas', 'materials'], cookie_v: ['video'] };
      const domains = [...new Set(Object.keys(r.fields ?? {}).flatMap((k) => domainMap[k] ?? []))];
      let refreshNote = '';
      if (domains.length) {
        setBrowserMsg({ ok: true, text: `✅ 已从 ${r.browser} 导入并保存：${lines}。正在刷新数据…` });
        try {
          const rr = await api.post('/refresh', { domains, force: true, reason: 'after-import' });
          const okList = (rr.ran ?? []).map((x) => x.label).join('、');
          const badList = (rr.failed ?? []).map((x) => x.label).join('、');
          refreshNote = badList ? `｜⚠️ ${badList} 仍失败` : `｜数据已刷新：${okList || '（无需刷新）'}`;
        } catch { refreshNote = '｜数据刷新失败，可点左下角「全部刷新」'; }
      }
      setBrowserMsg({
        ok: true,
        text: `✅ 已从 ${r.browser} 自动导入并保存：${lines}${r.note ? `｜${r.note}` : ''}${refreshNote}`,
      });
      setRunningBrowser('');
    } catch (e) {
      setBrowserMsg({ ok: false, text: e.message + (e.code === 'BROWSER_RUNNING' ? '（可点「自动关闭并导入」）' : '') });
    } finally { setBusy(null); }
  };

  // 从刷新面板跳过来：滚动到对应 Cookie 字段并聚焦
  useEffect(() => {
    if (!focusKey) return;
    const t = setTimeout(() => {
      const el = document.getElementById(`field-${focusKey}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const input = el.querySelector('input');
        if (input) input.focus();
      }
    }, 250);
    return () => clearTimeout(t);
  }, [focusKey]);

  const cookieFields = [
    { key: 'cookie_i', label: '教务系统 i.sjtu.edu.cn', hint: '课表、成绩、培养方案、考试安排', login: 'https://i.sjtu.edu.cn/' },
    { key: 'cookie_my', label: '交我办 my.sjtu.edu.cn', hint: '个人资料、今日日程、教务消息、在办事项', login: 'https://my.sjtu.edu.cn/' },
    { key: 'cookie_oc', label: 'Canvas oc.sjtu.edu.cn', hint: '课程、作业、课件资料', login: 'https://oc.sjtu.edu.cn/' },
    { key: 'cookie_v', label: '视频空间 v.sjtu.edu.cn', hint: '录播与 AI 字幕（走 Canvas 授权，可留空）', login: 'https://v.sjtu.edu.cn/' },
    { key: 'cookie_lib', label: '图书馆 libspace.sjtu.edu.cn', hint: '空间/座位预约（可选）', login: 'https://libspace.sjtu.edu.cn/' },
    { key: 'cookie_elec', label: '宿舍电费 elec.sjtu.edu.cn', hint: '剩余电量、充值记录（可选）', login: 'https://elec.sjtu.edu.cn/' },
    { key: 'cookie_dekt', label: '第二课堂 dektcjd.sjtu.edu.cn', hint: '劳动教育、志愿公益学时（可选）', login: 'https://dektcjd.sjtu.edu.cn/' },
  ];

  return (
    <div className="card">
      <div className="card-title"><Plug size={15} color="var(--accent)" /> 上海交通大学接入（jAccount Cookie）</div>

      <div className="card-title" style={{ fontSize: 14, marginTop: 4 }}>⚡ 快速接入（推荐）</div>
      <div className="section-note" style={{ borderColor: 'var(--ok)' }}>
        <b>不用手动找 Cookie 了：</b>在浏览器 DevTools 的 Network 里，对任意请求 <b>右键 → Copy → Copy as cURL</b>，
        把整段内容粘贴到下面，自动识别系统并填入对应字段。
      </div>
      <textarea
        rows={4}
        value={curlText}
        onChange={(e) => setCurlText(e.target.value)}
        placeholder={"curl 'https://i.sjtu.edu.cn/kbcx/xskbcx_cxXsgrkb.html' -H 'cookie: JSESSIONID=xxx; iPlanetDirectoryPro=yyy' ..."}
        style={{ fontFamily: 'Consolas, monospace', fontSize: 12 }}
      />
      <div style={{ marginTop: 8 }}>
        <button className="btn primary" onClick={extractCookie} disabled={!curlText.trim() || busy === 'extract'}>
          {busy === 'extract' ? '识别中…' : '智能识别并填入'}
        </button>
      </div>
      {curlMsg && (
        <div className="section-note" style={curlMsg.ok ? { borderColor: 'var(--ok)' } : { borderColor: 'var(--danger)' }}>
          {curlMsg.text}
        </div>
      )}

      {/* 从浏览器一键导入登录态 */}
      <div className="browser-import">
        <div className="browser-import-head">
          <Globe size={15} />
          <b>从浏览器一键导入登录态</b>
          <span className="chip gray">不用手动复制 Cookie</span>
        </div>
        <div className="item-meta" style={{ margin: '6px 0 8px' }}>
          自动读取本机 Chrome / Edge 里你已登录的交大 Cookie（教务 / 交我办 / Canvas / 图书馆 / 电费 / 第二课堂）。
          {runningBrowser && <span style={{ color: 'var(--warn)' }}> 检测到 {runningBrowser} 正在运行，需要先关闭它 —— 可以点下面的按钮自动关闭并重开。</span>}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn" onClick={openLoginPages} disabled={busy === 'openLogin'}>
            <ExternalLink size={14} /> {busy === 'openLogin' ? '打开中…' : '① 在 Chrome 打开登录页'}
          </button>
          <button className="btn primary" onClick={() => doBrowserImport(false)} disabled={busy === 'browserImport'}>
            <Globe size={14} /> {busy === 'browserImport' ? '导入中…' : '② 登录好了，一键导入'}
          </button>
          {runningBrowser && (
            <button className="btn" onClick={() => doBrowserImport(true)} disabled={busy === 'browserImport'}>
              <Power size={14} /> 自动关闭 {runningBrowser} 并导入
            </button>
          )}
        </div>
        <div className="item-meta" style={{ marginTop: 6, opacity: .85 }}>
          ⚠️ 请用 <b>Chrome</b> 登录（Edge 用了新版加密，我读不了）。导入时会自动关闭再重开浏览器。
        </div>
        {browserMsg && (
          <div className="section-note" style={{ marginTop: 8, whiteSpace: 'pre-wrap', ...(browserMsg.ok ? { borderColor: 'var(--ok)' } : { borderColor: 'var(--danger)' }) }}>
            {browserMsg.text}
          </div>
        )}
      </div>

      {/* 专用浏览器会话：根治登录过期 */}
      <div className="browser-import" style={{ borderColor: 'var(--ok)', background: '#f6fef9' }}>
        <div className="browser-import-head">
          <Globe size={15} />
          <b>工作台专用浏览器（推荐，一次登录长期有效）</b>
        </div>
        <div className="item-meta" style={{ margin: '6px 0 8px' }}>
          工作台会开一个**自己的** Chrome 窗口。你在里面登录一次后，会话就留在那儿；
          过期时工作台会**自动**去取，你不用再操作。
          {sess && <span> {sess.running ? '（窗口运行中 ✅）' : '（窗口未运行）'}</span>}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={openSession} disabled={busy === 'sessionOpen'}>
            <ExternalLink size={14} /> {busy === 'sessionOpen' ? '打开中…' : '① 打开专用窗口登录'}
          </button>
          <button className="btn primary" onClick={pullSession} disabled={busy === 'sessionPull'}>
            <RefreshCw size={14} /> {busy === 'sessionPull' ? '读取中…' : '② 读取登录态并刷新'}
          </button>
        </div>
      </div>
      {cookieFields.map((f) => (
        <div key={f.key} id={`field-${f.key}`} className={focusKey === f.key ? 'field-highlight' : ''}>
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span>{f.label}{settings[f.key] ? <span className="chip ok" style={{ marginLeft: 6 }}>已配置</span> : <span className="chip warn" style={{ marginLeft: 6 }}>未配置</span>}</span>
            {f.login && (
              <a className="btn sm" href={f.login} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
                去登录 ↗
              </a>
            )}
          </label>
          <input
            type="password"
            value={settings[f.key] ?? ''}
            onChange={(e) => set(f.key, e.target.value)}
            placeholder={`粘贴 ${f.label} 的 Cookie`}
          />
          <div style={{ fontSize: 11.5, color: 'var(--text-2)', marginTop: 2 }}>{f.hint}</div>
        </div>
      ))}

      <div className="form-grid">
        <div>
          <label>学年编码（xnm）</label>
          <input value={settings.sjtu_xnm ?? '2026'} onChange={(e) => set('sjtu_xnm', e.target.value)} placeholder="2026 = 2026-2027 学年" />
        </div>
        <div>
          <label>学期编码（xqm）</label>
          <select value={settings.sjtu_xqm ?? '3'} onChange={(e) => set('sjtu_xqm', e.target.value)}>
            <option value="3">3 · 秋</option>
            <option value="12">12 · 春</option>
            <option value="16">16 · 夏</option>
          </select>
        </div>
      </div>

      <div className="section-note">
        <b>Cookie 怎么拿？</b> 浏览器登录对应网站 → 按 F12 →「网络 / Network」→ 刷新页面 →
        点任意请求 → 复制请求头里完整的 <b>Cookie:</b> 值 → 粘贴到上面。<br />
        Cookie 只保存在本机数据库，只会发往对应的 sjtu.edu.cn 站点，请放心。
      </div>

      <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn" disabled={!!busy} onClick={() => run('status', () => api.get('/sjtu/status'))}>
          <Plug size={14} /> 测试连接
        </button>
        <button className="btn primary" disabled={!!busy} onClick={() => run('schedule', () => api.post('/sjtu/sync/schedule'))}>
          <CalendarDays size={14} /> {busy === 'schedule' ? '同步中…' : '同步课表'}
        </button>
        <button className="btn" disabled={!!busy} onClick={() => run('grades', () => api.post('/sjtu/sync/grades'))}>
          <GraduationCap size={14} /> {busy === 'grades' ? '同步中…' : '同步成绩'}
        </button>
        <button className="btn" disabled={!!busy} onClick={() => run('progress', () => api.post('/sjtu/sync/progress'))}>
          <Target size={14} /> {busy === 'progress' ? '同步中…' : '同步培养方案'}
        </button>
        <button className="btn" disabled={!!busy} onClick={() => run('exams', () => api.post('/sjtu/sync/exams'))}>
          <FileCheck size={14} /> {busy === 'exams' ? '同步中…' : '同步考试安排'}
        </button>
        <button className="btn" disabled={!!busy} onClick={() => run('canvas', () => api.post('/canvas/sync'))}>
          <RefreshCw size={14} /> {busy === 'canvas' ? '同步中…' : '同步 Canvas'}
        </button>
        <button className="btn" disabled={!!busy} onClick={() => run('canvas', () => api.post('/canvas/sync/files'))}>
          <FolderOpen size={14} /> 同步 Canvas 课件
        </button>
      </div>

      {result && (
        <div className="section-note" style={result.ok ? { borderColor: 'var(--ok)' } : { borderColor: 'var(--danger)' }}>
          {result.ok ? <CheckCircle2 size={13} style={{ verticalAlign: -2 }} /> : '⚠️ '} {result.text}
        </div>
      )}
    </div>
  );
}
