import { useEffect, useRef, useState } from 'react';
import { RefreshCw, ChevronUp, AlertTriangle, CheckCircle2, LogIn, ClipboardPaste } from 'lucide-react';
import { api } from '../api.js';

const ageText = (min) => {
  if (min == null) return '未同步';
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
};

export default function RefreshBar() {
  const [fr, setFr] = useState(null);
  const [health, setHealth] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const [hover, setHover] = useState(false);   // 鼠标移到药丸上才浮现提示，避免遮挡页面
  const didAuto = useRef(false);

  const loadFreshness = () => api.get('/freshness').then(setFr).catch(() => setFr(null));
  const loadHealth = () => api.get('/session/health').then(setHealth).catch(() => setHealth(null));

  // 进入页面：先显示缓存状态；仅当有域过期时才后台静默刷新（避免每次进页面都打学校服务器）
  useEffect(() => {
    (async () => {
      const f = await api.get('/freshness').catch(() => null);
      setFr(f);
      loadHealth();
      if (f && f.staleCount > 0 && !didAuto.current) {
        didAuto.current = true;
        try {
          const r = await api.post('/refresh', { reason: 'page-open' });
          if (r.ok && r.ran?.length) {
            setMsg({ ok: true, text: `已自动更新 ${r.ran.length} 项（${r.ran.map((x) => x.label).join('、')}）` });
            setTimeout(() => setMsg(null), 8000);
          }
          if (r.ok && r.failed?.length) {
            setMsg({ ok: false, text: `${r.failed.map((x) => x.label).join('、')} 同步失败：${r.failed[0].message}` });
          }
          await loadFreshness();
        } catch { /* 静默失败 */ }
      }
    })();
    // 每 5 分钟刷新一次显示（不请求学校，只读本地状态）
    const t = setInterval(loadFreshness, 300000);
    return () => clearInterval(t);
  }, []);

  const doRefresh = async (force) => {
    setBusy(force ? 'all' : 'stale');
    setMsg(null);
    try {
      const r = await api.post('/refresh', { force, reason: force ? 'manual-all' : 'manual' });
      const parts = [];
      if (r.ran?.length) parts.push(`已更新 ${r.ran.map((x) => x.label).join('、')}`);
      if (r.skipped?.length) parts.push(`跳过 ${r.skipped.length} 项（还新鲜）`);
      if (r.failed?.length) parts.push(`失败：${r.failed.map((x) => x.label).join('、')}`);
      setMsg({ ok: !r.failed?.length, text: parts.join(' · ') || '没有需要刷新的内容' });
      await loadFreshness();
    } catch (e) {
      setMsg({ ok: false, text: '刷新失败：' + e.message });
    } finally { setBusy(''); }
  };

  if (!fr) return null;

  const stale = fr.staleCount;
  const errs = fr.errCount;
  const dotColor = errs > 0 ? 'var(--danger)' : stale > 0 ? 'var(--warn)' : 'var(--ok)';
  const summary = errs > 0
    ? `${errs} 项需要重新登录`
    : stale > 0
      ? `${stale} 项待更新`
      : '数据都是最新的';

  return (
    <div className="refresh-wrap">
      {open && (
        <div className="refresh-panel">
          <div className="refresh-head">
            <b>数据新鲜度</b>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn sm" onClick={() => doRefresh(false)} disabled={!!busy}>
                {busy === 'stale' ? '刷新中…' : '刷新过期的'}
              </button>
              <button className="btn sm" onClick={() => doRefresh(true)} disabled={!!busy}>
                {busy === 'all' ? '刷新中…' : '全部刷新'}
              </button>
            </div>
          </div>

          {/* 提示放在面板内部，不再浮在外面遮挡内容 */}
          {msg && (
            <div className="refresh-msg-inline" style={msg.ok ? undefined : { borderColor: 'var(--danger)', color: 'var(--danger)' }}>
              {msg.text}
            </div>
          )}
          {fr.domains.map((d) => (
            <div className="refresh-item" key={d.key}>
              {d.status === 'error'
                ? <AlertTriangle size={14} color="var(--danger)" />
                : d.stale
                  ? <AlertTriangle size={14} color="var(--warn)" />
                  : <CheckCircle2 size={14} color="var(--ok)" />}
              <div className="item-main">
                <div className="item-title" style={{ fontSize: 13 }}>{d.label}</div>
                <div className="item-meta">
                  <span>{ageText(d.ageMinutes)}</span>
                  <span className="chip gray">每 {d.intervalMin >= 60 ? `${d.intervalMin / 60} 小时` : `${d.intervalMin} 分钟`}</span>
                  {d.status === 'error' && <span className="chip danger">需处理</span>}
                </div>
                {d.status === 'error' && d.message && (
                  <div className="item-meta" style={{ color: 'var(--danger)' }}>{d.message}</div>
                )}

                {/* 需要重新登录 → 一键跳转 */}
                {d.status === 'error' && d.needLogin && (
                  <div className="refresh-actions">
                    {d.loginUrl && (
                      <a className="btn sm primary" href={d.loginUrl} target="_blank" rel="noreferrer">
                        <LogIn size={13} /> 去 {d.site || d.label} 登录
                      </a>
                    )}
                    {d.cookieKey && (
                      <a className="btn sm" href={`/settings?focus=${d.cookieKey}`}>
                        <ClipboardPaste size={13} /> 粘贴 Cookie
                      </a>
                    )}
                  </div>
                )}

                {d.hint && d.status !== 'error' && <div className="item-meta" style={{ opacity: 0.75 }}>{d.hint}</div>}
              </div>
            </div>
          ))}
          {health && (
            <div className="sess-health">
              <div className="sess-health-head">
                <b>登录态健康</b>
                <span className={'chip ' + (health.expiredCount ? 'danger' : health.expiringCount ? 'warn' : 'ok')}>
                  {health.expiredCount ? health.expiredCount + ' 个已失效' : health.expiringCount ? health.expiringCount + ' 个将过期' : '全部健康'}
                </span>
              </div>
              {health.items.filter(function (x) { return x.status !== 'unknown' && x.status !== 'public'; }).map(function (x) {
                var days = x.remainMinutes / 1440;
                var remain = x.status === 'expired' || x.status === 'overdue'
                  ? '需续期'
                  : days >= 1 ? '约 ' + days.toFixed(1) + ' 天后' : '约 ' + Math.max(0, Math.round(x.remainMinutes / 60)) + ' 小时后';
                var name = { jw: '教务', my: '交我办', canvas: 'Canvas', video: '视频空间', materials: '课件' }[x.domain] || x.domain;
                return (
                  <div className="sess-health-row" key={x.domain}>
                    <span>{name}</span>
                    <span className={'sess-dot ' + x.status} />
                    <span style={{ color: 'var(--text-2)' }}>
                      {x.status === 'expired' ? '已失效' : '预计 ' + remain + '过期'}
                      {x.learnedFromSamples > 0 ? '（已学习 ' + x.learnedFromSamples + ' 次）' : ''}
                    </span>
                  </div>
                );
              })}
              <div className="sess-health-advice">{health.advice}</div>
            </div>
          )}
          {errs > 0 && (
            <div className="section-note" style={{ marginTop: 8, fontSize: 12 }}>
              💡 自动恢复流程：点「去登录」→ 在**工作台专用浏览器**窗口登录一次 → 刷新会自动重取登录态。

            </div>
          )}
        </div>
      )}

      {/* 提示浮层：默认隐藏，鼠标悬停药丸时才浮现（避免遮挡页面内容） */}
      {msg && !open && hover && (
        <div className="refresh-msg" style={msg.ok ? undefined : { borderColor: 'var(--danger)', color: 'var(--danger)' }}>
          {msg.text}
        </div>
      )}

      <button
        className="refresh-pill"
        onClick={() => setOpen(!open)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        title="查看各数据源新鲜度"
      >
        <span className="dot" style={{ background: dotColor }} />
        <span>{summary}</span>
        {errs > 0 && (
          <a
            className="refresh-pill-link"
            href={fr.domains.find((d) => d.status === 'error' && d.loginUrl)?.loginUrl ?? '/settings'}
            target={fr.domains.find((d) => d.status === 'error' && d.loginUrl) ? '_blank' : undefined}
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            去登录 ↗
          </a>
        )}
        <ChevronUp size={14} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
      </button>
    </div>
  );
}
