// 登录态健康度监测：学习每个系统会话的寿命，提前预测过期并提醒续期
//
// 设计原则：**不存密码**也能做到智能化 —— 靠统计会话寿命来预测，
// 让用户在「即将过期」时被提前告知，而不是等数据不更新了才发现。
import { q, q1, run, nowISO } from '../db.js';

// 默认寿命估计（分钟）——在采样不足时使用；来源于实测观察
const DEFAULT_LIFETIME_MIN = {
  jw: 3 * 24 * 60,       // 教务 ~3 天
  my: 3 * 24 * 60,       // 交我办
  canvas: 3 * 24 * 60,   // Canvas ~3 天
  video: 3 * 24 * 60,
  materials: 3 * 24 * 60,
  feed: 0,               // 公开数据，无登录态
};

const MAX_SAMPLES = 10;
const WARN_BEFORE_MIN = 12 * 60;   // 预计过期前 12 小时开始预警

function blank(domain) {
  return {
    domain, session_start: '', last_ok: '', last_fail: '',
    fail_count: 0, ok_count: 0, lifetimes: '[]', avg_lifetime_min: 0, updated_at: '',
  };
}

export function getHealth(domain) {
  return q1('SELECT * FROM session_health WHERE domain = ?', domain) ?? blank(domain);
}

function save(h) {
  run(
    `INSERT INTO session_health (domain, session_start, last_ok, last_fail, fail_count, ok_count, lifetimes, avg_lifetime_min, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(domain) DO UPDATE SET
       session_start=excluded.session_start, last_ok=excluded.last_ok, last_fail=excluded.last_fail,
       fail_count=excluded.fail_count, ok_count=excluded.ok_count, lifetimes=excluded.lifetimes,
       avg_lifetime_min=excluded.avg_lifetime_min, updated_at=excluded.updated_at`,
    h.domain, h.session_start, h.last_ok, h.last_fail, h.fail_count, h.ok_count,
    h.lifetimes, h.avg_lifetime_min, nowISO()
  );
}

const minutesBetween = (a, b) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);

// 记录一次成功
export function recordOk(domain) {
  if (domain === 'feed') return;
  const h = getHealth(domain);
  const now = nowISO();

  if (h.fail_count > 0) {
    // 上一轮是失败的 → 说明期间发生了「续期」。用 session_start → 现在 估算上一段会话寿命
    if (h.session_start) {
      const life = minutesBetween(h.session_start, now);
      if (life > 10 && life < 120 * 24 * 60) {
        const arr = JSON.parse(h.lifetimes || '[]');
        arr.push(life);
        h.lifetimes = JSON.stringify(arr.slice(-MAX_SAMPLES));
        h.avg_lifetime_min = Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
      }
    }
    h.session_start = now;          // 新会话开始
    h.fail_count = 0;
  } else if (!h.session_start) {
    h.session_start = now;          // 首次记录
  }
  h.last_ok = now;
  h.ok_count = (h.ok_count ?? 0) + 1;
  save(h);
}

// 记录一次失败（登录失效）
export function recordFail(domain) {
  if (domain === 'feed') return;
  const h = getHealth(domain);
  h.fail_count = (h.fail_count ?? 0) + 1;
  h.last_fail = nowISO();
  save(h);
}

// 计算某域的预测信息
export function predict(domain) {
  const h = getHealth(domain);
  if (domain === 'feed') return { domain, status: 'public', label: '公开数据（无需登录）' };
  if (!h.session_start && !h.last_fail) return { domain, status: 'unknown', label: '暂无数据' };

  const avg = h.avg_lifetime_min || DEFAULT_LIFETIME_MIN[domain] || 3 * 24 * 60;
  const learned = h.avg_lifetime_min > 0;
  const start = h.session_start || h.last_fail;
  const ageMin = minutesBetween(start, nowISO());
  const remainMin = avg - ageMin;
  const expiryAt = new Date(new Date(start).getTime() + avg * 60000).toISOString();

  let status = 'healthy';
  if (h.fail_count > 0) status = 'expired';
  else if (remainMin <= 0) status = 'overdue';
  else if (remainMin <= WARN_BEFORE_MIN) status = 'expiring';

  return {
    domain,
    status,
    sessionStart: h.session_start,
    lastOk: h.last_ok,
    lastFail: h.last_fail,
    failCount: h.fail_count,
    ageMinutes: ageMin,
    avgLifetimeMin: avg,
    learnedFromSamples: learned ? JSON.parse(h.lifetimes || '[]').length : 0,
    remainMinutes: remainMin,
    predictedExpiry: expiryAt,
    label: {
      healthy: '正常', expiring: '即将过期', overdue: '预计已过期', expired: '已失效需续期', unknown: '暂无数据',
    }[status] ?? status,
  };
}

// 汇总所有域 + jAccount 级别判断
export function healthReport() {
  const domains = ['jw', 'my', 'canvas', 'video', 'materials'];
  const items = domains.map(predict);
  const expired = items.filter((x) => x.status === 'expired');
  const expiring = items.filter((x) => x.status === 'expiring' || x.status === 'overdue');

  // 多个系统同时失效 → 大概率是 jAccount 本身过期
  const jaccountLikely = expired.length >= 2;

  let advice = '';
  if (jaccountLikely) {
    advice = '多个系统同时失效 → 很可能是 jAccount 统一认证会话过期。请打开「工作台专用浏览器」窗口登录一次（一次即可恢复全部）。';
  } else if (expiring.length) {
    advice = `有 ${expiring.length} 个系统的登录态预计即将过期（${expiring.map((x) => x.label).join('、')}），建议现在就去专用窗口续期一次，避免用到一半失效。`;
  } else if (expired.length) {
    advice = `${expired.map((x) => x.label).join('、')} 已失效，点「读取登录态」或刷新会自动尝试恢复。`;
  } else {
    advice = '所有登录态健康，无需操作。';
  }

  return {
    checkedAt: nowISO(),
    jaccountLikelyExpired: jaccountLikely,
    expiredCount: expired.length,
    expiringCount: expiring.length,
    items,
    advice,
  };
}
