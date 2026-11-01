// 刷新调度引擎：按「数据变化速度」分层，过期才刷（stale-while-revalidate）
//
// 设计原则（见 README「刷新机制」）：
//   1. 不同数据变化速度差很多 —— 信息源天天变，培养方案一学期变几次 → 分开设间隔
//   2. 「退出重进就刷新」是反模式：拖慢页面、频繁打学校服务器触发风控、浪费 AI 筛选成本
//      → 进入页面时只在前端「后台静默刷新」且仅当数据已过期
//   3. 所有刷新都走同一个入口，状态落库，前端可显示「几分钟前更新」
import { q, q1, run, nowISO } from '../db.js';

const PORT = Number(process.env.PORT || 3910);
const BASE = `http://127.0.0.1:${PORT}`;

// 域名 → 该域包含的接口 + 建议刷新间隔（分钟）+ 登录信息（用于一键跳转重新登录）
export const DOMAINS = [
  {
    key: 'feed', label: '信息源', intervalMin: 60, hint: '学校/学院通知、公众号文章，变化最快',
    loginUrl: '', cookieKey: '', site: '校内各网站',
    steps: [
      { method: 'POST', path: '/api/feed/fetch-all', label: '抓取信息源' },
      // 顺手做 AI 筛选与今日简报（没有新条目时不花钱、秒回）
      { method: 'POST', path: '/api/feed/rank', label: 'AI 筛选', body: { limit: 20 } },
      { method: 'POST', path: '/api/feed/digest', label: '今日简报' },
    ],
  },
  {
    key: 'canvas', label: 'Canvas 作业', intervalMin: 180, hint: '作业与截止时间',
    loginUrl: 'https://oc.sjtu.edu.cn/', cookieKey: 'cookie_oc', site: 'Canvas',
    steps: [
      { method: 'POST', path: '/api/canvas/sync', label: '课程与作业' },
      { method: 'POST', path: '/api/canvas/sync/announcements', label: '课程公告' },
    ],
  },
  {
    key: 'my', label: '交我办', intervalMin: 180, hint: '待办事项、未读消息',
    loginUrl: 'https://my.sjtu.edu.cn/', cookieKey: 'cookie_my', site: '交我办',
    steps: [{ method: 'GET', path: '/api/sjtu/today', label: '今日日程与待办' }],
  },
  {
    key: 'jw', label: '教务', intervalMin: 720, hint: '课表、成绩、培养方案、考试（变化慢）',
    loginUrl: 'https://i.sjtu.edu.cn/', cookieKey: 'cookie_i', site: '教务系统',
    steps: [
      { method: 'POST', path: '/api/sjtu/sync/schedule', label: '课表' },
      { method: 'POST', path: '/api/sjtu/sync/grades', label: '成绩' },
      { method: 'POST', path: '/api/sjtu/sync/progress', label: '培养方案' },
      { method: 'POST', path: '/api/sjtu/sync/exams', label: '考试安排' },
    ],
  },
  {
    key: 'materials', label: '课程课件', intervalMin: 720, hint: '老师上传的 PPT/PDF',
    loginUrl: 'https://oc.sjtu.edu.cn/', cookieKey: 'cookie_oc', site: 'Canvas',
    steps: [{ method: 'POST', path: '/api/canvas/sync/files', label: '课件清单' }],
  },
  {
    key: 'video', label: '视频空间', intervalMin: 720, hint: '课堂录播（每次课后更新）',
    loginUrl: 'https://oc.sjtu.edu.cn/', cookieKey: 'cookie_oc', site: 'Canvas（视频走 Canvas 授权）',
    steps: [{ method: 'GET', path: '/api/video/courses', label: '录播列表' }],
  },
  {
    // 课次内化：每节课结束后自动把 PPT + 回放字幕 + AI 总结抓回来
    key: 'lectures', label: '课次内化', intervalMin: 60,
    hint: '课后自动读取 PPT 与回放（上课日每小时检查一次）',
    loginUrl: 'https://oc.sjtu.edu.cn/', cookieKey: 'cookie_oc', site: 'Canvas（视频走 Canvas 授权）',
    steps: [{ method: 'POST', path: '/api/lectures/ingest', label: '抓取新课次', body: { sinceDays: 30 } }],
  },
];

export const DOMAIN_MAP = Object.fromEntries(DOMAINS.map((d) => [d.key, d]));

function stateOf(domain) {
  const row = q1('SELECT * FROM sync_state WHERE domain = ?', domain);
  return row ?? { domain, last_run: '', last_ok: '', status: 'idle', message: '' };
}

function saveState(domain, { status, message }) {
  const now = nowISO();
  const okAt = status === 'ok' ? now : (stateOf(domain).last_ok || '');
  run(
    `INSERT INTO sync_state (domain, last_run, last_ok, status, message) VALUES (?,?,?,?,?)
     ON CONFLICT(domain) DO UPDATE SET last_run = excluded.last_run, last_ok = excluded.last_ok,
       status = excluded.status, message = excluded.message`,
    domain, now, okAt, status, message ?? ''
  );
}

function ageMinutes(iso) {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / 60000;
}

// 每个域的实时新鲜度
export function getFreshness() {
  const list = DOMAINS.map((d) => {
    const st = stateOf(d.key);
    const age = ageMinutes(st.last_ok);
    return {
      key: d.key,
      label: d.label,
      hint: d.hint,
      intervalMin: d.intervalMin,
      loginUrl: d.loginUrl ?? '',
      cookieKey: d.cookieKey ?? '',
      site: d.site ?? '',
      lastOk: st.last_ok || null,
      lastRun: st.last_run || null,
      ageMinutes: Number.isFinite(age) ? Math.round(age) : null,
      stale: age > d.intervalMin,
      status: st.status,
      message: st.message,
      needLogin: st.status === 'error' && /Cookie|登录|401|未登录|502/.test(st.message ?? ''),
    };
  });
  const staleCount = list.filter((x) => x.stale).length;
  const errCount = list.filter((x) => x.status === 'error').length;
  return { domains: list, staleCount, errCount, checkedAt: nowISO() };
}

async function callStep(step) {
  const res = await fetch(BASE + step.path, {
    method: step.method,
    headers: { 'Content-Type': 'application/json' },
    body: step.method === 'POST' ? JSON.stringify(step.body ?? {}) : undefined,
  });
  const text = await res.text();
  let j = null;
  try { j = JSON.parse(text); } catch { /* 非 JSON */ }
  if (!res.ok) {
    // 优先用 body 里的具体错误（如交我办返回 errors:["日程: HTTP 401", ...]）
    const detail = Array.isArray(j?.errors) && j.errors.length
      ? j.errors.join('；')
      : (j?.error || j?.message || `HTTP ${res.status}`);
    const friendly = /401|未登录|登录已过期|Cookie/.test(String(detail))
      ? `Cookie 已失效，需重新登录（${String(detail).slice(0, 40)}）`
      : String(detail);
    const err = new Error(friendly);
    err.payload = j;
    throw err;
  }
  // 有些接口 HTTP 200 但 body 里报错（如交我办返回 errors 数组）
  if (j && j.ok === false) {
    const detail = Array.isArray(j.errors) && j.errors.length ? j.errors.join('；') : (j.error || '接口返回失败');
    const err = new Error(String(detail).slice(0, 90));
    err.payload = j;
    throw err;
  }
  return j ?? {};
}

// 执行刷新：domains 指定域（默认全部过期的）；force 忽略间隔强制刷
export async function runRefresh({ domains, force = false, reason = 'manual' } = {}) {
  const keys = domains?.length ? domains.filter((k) => DOMAIN_MAP[k]) : DOMAINS.map((d) => d.key);
  const report = { reason, startedAt: nowISO(), force, ran: [], skipped: [], failed: [], recovered: [] };

  await runOnce(keys, { force, report });

  // ── 自愈：若有域因「登录失效」失败 → 自动从工作台专用浏览器取登录态 → 重试一次 ──
  const loginFailed = report.failed.filter((f) => /Cookie|登录|401|未登录|鉴权/.test(f.message));
  if (loginFailed.length) {
    try {
      const { readAllCookies, ensureBrowser, ensureSessions } = await import('./live-session.js');
      const { setSettings } = await import('../db.js');
      // 1) 确保专用浏览器在运行（电脑重启后它可能没开；开起来才能取会话）
      try { await ensureBrowser(); } catch { /* 起不来就跳过 */ }
      // 2) 静默恢复各系统登录态（jAccount 会话活着时自动完成，无需用户操作）
      try { await ensureSessions(); } catch { /* 忽略 */ }
      const cookies = await readAllCookies();
      const HOST_FIELD = [
        [/(^|\.)i\.sjtu\.edu\.cn$/, 'cookie_i', '教务'],
        [/(^|\.)my\.sjtu\.edu\.cn$/, 'cookie_my', '交我办'],
        [/(^|\.)oc\.sjtu\.edu\.cn$/, 'cookie_oc', 'Canvas'],
        [/(^|\.)v\.sjtu\.edu\.cn$/, 'cookie_v', '视频空间'],
        [/libspace\.sjtu\.edu\.cn$/, 'cookie_lib', '图书馆'],
        [/(^|\.)elec\.sjtu\.edu\.cn$/, 'cookie_elec', '电费'],
        [/dektcjd\.sjtu\.edu\.cn$/, 'cookie_dekt', '第二课堂'],
      ];
      const byHost = {};
      for (const c of cookies) {
        const h = c.domain.replace(/^\./, '');
        if (h === 'jaccount.sjtu.edu.cn') continue;
        (byHost[h] = byHost[h] ?? []).push(c.name + '=' + c.value);
      }
      const fields = {};
      for (const [host, pairs] of Object.entries(byHost)) {
        const rule = HOST_FIELD.find(([re]) => re.test(host));
        if (!rule) continue;
        const str = pairs.join('; ');
        fields[rule[1]] = fields[rule[1]] ? (fields[rule[1]] + '; ' + str) : str;
      }
      if (Object.keys(fields).length) {
        setSettings(fields);
        report.recovered.push({ step: '已从专用浏览器自动获取登录态', fields: Object.keys(fields) });
        const retryKeys = [...new Set(loginFailed.map((f) => f.key))];
        for (const k of retryKeys) {
          const idx = report.failed.findIndex((f) => f.key === k);
          if (idx >= 0) report.failed.splice(idx, 1);
        }
        const sub = { reason: reason + '+retry', startedAt: nowISO(), force: true, ran: [], skipped: [], failed: [], recovered: [] };
        await runOnce(retryKeys, { force: true, report: sub });
        report.ran.push(...sub.ran);
        report.failed.push(...sub.failed);
      } else {
        report.recovered.push({ step: '专用浏览器里没有登录态', hint: '请在弹出的专用窗口里登录一次' });
      }
    } catch (e) {
      report.recovered.push({ step: '自动获取登录态失败', error: e.message });
    }
  }

  report.finishedAt = nowISO();
  report.freshness = getFreshness();
  return report;
}

// 单轮执行（内部用）
async function runOnce(keys, { force, report }) {
  for (const key of keys) {
    const d = DOMAIN_MAP[key];
    const st = stateOf(key);
    const age = ageMinutes(st.last_ok);
    if (!force && age <= d.intervalMin) {
      report.skipped.push({ key, label: d.label, ageMinutes: Number.isFinite(age) ? Math.round(age) : null, intervalMin: d.intervalMin });
      continue;
    }
    const detail = [];
    let failed = false;
    for (const step of d.steps) {
      try {
        const r = await callStep(step);
        const added = r.added ?? 0;
        detail.push(`${step.label}✓${added ? `(+${added})` : ''}`);
      } catch (e) {
        failed = true;
        // 错误信息可能很长（含 HTML），截断避免刷屏
        const msg = String(e.message || '未知错误').replace(/\s+/g, ' ').slice(0, 90);
        detail.push(`${step.label}✗${msg}`);
      }
    }
    const message = detail.join(' · ');
    saveState(key, { status: failed ? 'error' : 'ok', message });
    if (failed) report.failed.push({ key, label: d.label, message });
    else report.ran.push({ key, label: d.label, message });

    // 登录态健康度记录（学习会话寿命，用于提前预测过期）
    try {
      const { recordOk, recordFail } = await import('./session-health.js');
      if (failed && /Cookie|登录|401|未登录|鉴权/.test(message)) recordFail(key);
      else if (!failed) recordOk(key);
    } catch { /* 忽略 */ }
  }
  return report;
}

// 开机/登录后若过期，补一次（给计划任务用）
export async function catchUpIfStale() {
  const fr = getFreshness();
  if (fr.staleCount === 0) return { ran: false, reason: '数据都是新的', freshness: fr };
  const r = await runRefresh({ reason: 'catchup' });
  return { ran: true, ...r };
}
