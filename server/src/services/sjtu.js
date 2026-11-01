// 上海交通大学系统接入（基于《交大接入包》实测端点）
// 鉴权：jAccount SSO 后的站点 Cookie，由用户粘贴到「导入与设置」
import { getSettings } from '../db.js';
import { parseDay, parseWeeks, parseSections, secStart, CLASS_MIN } from './import.js';
import { courseColorFor } from './canvas.js';

const HOST_MAP = {
  i: 'https://i.sjtu.edu.cn',      // 教务
  my: 'https://my.sjtu.edu.cn',    // 交我办
  oc: 'https://oc.sjtu.edu.cn',    // Canvas
  v: 'https://v.sjtu.edu.cn',      // 视频空间
};

export function cookieFor(key) {
  return String(getSettings()[`cookie_${key}`] ?? '').trim();
}

// Cookie 只发往对应站点，绝不外泄
async function sjtuFetch(url, { cookie, method = 'GET', form, headers = {} } = {}) {
  const opts = { method, headers: { ...headers } };
  if (cookie) opts.headers.Cookie = cookie;
  if (form) {
    opts.headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    opts.body = new URLSearchParams(form).toString();
  }
  const res = await fetch(url, opts);
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res;
}

function semester() {
  const s = getSettings();
  return { xnm: s.sjtu_xnm || '2026', xqm: s.sjtu_xqm || '3' };
}

// 教务接口预期返回 JSON；若返回 HTML 登录页 → Cookie 已失效，给出明确提示
async function readJsonOrAuthError(res, systemLabel) {
  const text = await res.text();
  const t = text.trim();
  if (t.startsWith('{') || t.startsWith('[')) {
    try { return JSON.parse(t); } catch { /* 落到下面 */ }
  }
  const isLogin = /统一身份认证|jaccount|登录|请先登录/i.test(text);
  const err = new Error(
    isLogin || t.startsWith('<')
      ? `${systemLabel} Cookie 已失效（返回登录页），请到「导入与设置 → 上海交通大学接入」重新粘贴`
      : `${systemLabel} 返回了非预期内容（可能页面结构变化）`
  );
  err.status = 401;
  throw err;
}

// ================= 教务：课表（纯 JSON） =================
export async function fetchSchedule() {
  const cookie = cookieFor('i');
  if (!cookie) throw new Error('请先在「导入与设置 → 上海交通大学接入」粘贴教务系统(i.sjtu.edu.cn)的 Cookie');
  const { xnm, xqm } = semester();
  const res = await sjtuFetch(`${HOST_MAP.i}/kbcx/xskbcx_cxXsgrkb.html`, {
    cookie,
    method: 'POST',
    form: { xnm, xqm, _search: 'false', nd: Date.now() },
  });
  const j = await readJsonOrAuthError(res, '教务');
  if (!Array.isArray(j.kbList)) {
    throw new Error('教务课表返回异常（可能是 Cookie 过期或学期编码不对）');
  }
  return j;
}

// kbList → 课程 + 时段
export function mapScheduleToData(data) {
  const courses = new Map();
  const slots = [];
  const warnings = [];
  for (const item of data.kbList ?? []) {
    const name = String(item.kcmc ?? '').trim();
    if (!name) continue;
    // 优先用教务的数字星期 xqj，其次解析 xqjmc
    const day = parseDay(item.xqj ?? item.xqjmc);
    const secs = parseSections(item.jcor ?? item.jc);
    if (day == null || !secs) {
      warnings.push(`「${name}」星期(${item.xqjmc})或节次(${item.jc})无法识别，已跳过`);
      continue;
    }
    const startMin = secStart(secs.start);
    const endMin = secStart(secs.end);
    if (startMin == null || endMin == null) {
      warnings.push(`「${name}」节次超出范围(${item.jc})，已跳过`);
      continue;
    }
    const wk = parseWeeks(item.zcd);
    if (!courses.has(name)) {
      courses.set(name, {
        name,
        teacher: String(item.xm ?? '').trim(),
        credits: Number(item.xf) || 0,
      });
    }
    slots.push({
      course_name: name,
      day_of_week: day,
      start_min: startMin,
      end_min: endMin + CLASS_MIN,
      weeks: wk.weeks,
      week_parity: wk.parity,
      location: String(item.cdmc ?? '').trim(),
    });
  }
  const courseList = [...courses.values()].map((c, i) => ({ ...c, color: courseColorFor(i) }));
  return { courses: courseList, slots, warnings };
}

// ================= 教务：成绩（JSON，需 doType=query） =================
export async function fetchGrades({ xnm, xqm } = {}) {
  const cookie = cookieFor('i');
  if (!cookie) throw new Error('请先粘贴教务系统 Cookie');
  const form = { doType: 'query', 'queryModel.showCount': '200', 'queryModel.currentPage': '1' };
  if (xnm) form.xnm = xnm;
  if (xqm) form.xqm = xqm;
  const res = await sjtuFetch(`${HOST_MAP.i}/cjcx/cjcx_cxDgXscj.html?gnmkdm=N305005`, {
    cookie,
    method: 'POST',
    form,
  });
  const ct = res.headers.get('content-type') || '';
  const text = await res.text();
  if (!/json/i.test(ct)) {
    // 先判断是不是登录页（Cookie 失效），再退回 HTML 表格解析
    if (/统一身份认证|jaccount|请先登录|<title>上海交通大学教学信息服务网/i.test(text) || text.trim().startsWith('<!doctype')) {
      const err = new Error('教务 Cookie 已失效（返回登录页），请到「导入与设置 → 上海交通大学接入」重新粘贴');
      err.status = 401;
      throw err;
    }
    const parsed = parseGradeTable(text);
    if (parsed.ok) {
      return {
        source: 'html',
        items: parsed.grades.map((g) => ({
          kcmc: g.name, cj: String(g.score ?? ''), bfzcj: String(g.score ?? ''),
          xf: String(g.credit ?? ''), xnmmc: g.term, xqmmc: '',
        })),
      };
    }
    throw new Error('教务成绩接口返回了非预期内容（可能页面结构变化）');
  }
  const j = await readJsonOrAuthError({ text: async () => text }, '教务');
  return { source: 'json', items: Array.isArray(j.items) ? j.items : [] };
}

// 成绩记录 → 本地成绩结构（区分百分制 / 等级制）
export function parseGradeItems(items) {
  const out = [];
  for (const it of items ?? []) {
    const name = String(it.kcmc ?? '').trim();
    if (!name) continue;
    const cj = String(it.cj ?? '').trim();
    const bfzcj = String(it.bfzcj ?? '').trim();
    const isNumeric = (v) => /^\d+(\.\d+)?$/.test(v);
    let score = null;
    let note = '教务系统同步';
    if (isNumeric(cj)) score = Number(cj);
    else if (!cj && isNumeric(bfzcj)) score = Number(bfzcj);
    else if (cj) note = `等级制:${cj}`; // P / 通过 / 优 / 良 —— 不计入 GPA，通过则计学分
    if (String(it.jsxm ?? '').trim()) note += ` · ${String(it.jsxm).trim()}`;
    const term = `${it.xnmmc ?? it.xnm ?? ''}${it.xqmmc ? '-' + it.xqmmc : ''}`.trim();
    out.push({
      name,
      code: String(it.kch ?? '').trim(),
      score,
      credit: Number(it.xf) || null,
      term,
      note,
    });
  }
  return out;
}

// 宽容解析正方成绩表 HTML（兜底）
export function parseGradeTable(html) {
  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const tdRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let m;
  while ((m = trRe.exec(html))) {
    const cells = [];
    let cm;
    const inner = m[1];
    while ((cm = tdRe.exec(inner))) {
      cells.push(
        cm[1]
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      );
    }
    if (cells.length >= 3) rows.push(cells);
  }
  const hi = rows.findIndex((r) => r.some((c) => /课程/.test(c)) && r.some((c) => /成绩|学分/.test(c)));
  if (hi < 0) {
    return { ok: false, error: '无法识别成绩表结构（页面可能已变化）。可先在网页上打开成绩页确认，或手动录入成绩。' };
  }
  const head = rows[hi];
  const iName = head.findIndex((c) => /课程/.test(c));
  const iScore = head.findIndex((c) => /总成绩|成绩|分数/.test(c));
  const iCredit = head.findIndex((c) => /学分/.test(c));
  const iTerm = head.findIndex((c) => /学年|学期/.test(c));
  const grades = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    const name = iName >= 0 ? r[iName] : '';
    if (!name || /合计|平均|总计|绩点/.test(name)) continue;
    const rawScore = iScore >= 0 ? r[iScore] : '';
    const score = parseFloat(rawScore);
    grades.push({
      name,
      score: Number.isNaN(score) ? null : score,
      credit: iCredit >= 0 ? parseFloat(r[iCredit]) || null : null,
      term: iTerm >= 0 ? r[iTerm] : '',
    });
  }
  if (grades.length === 0) {
    return { ok: false, error: '成绩表为空（可能本学期还没有成绩，或页面结构变化）' };
  }
  return { ok: true, grades };
}

// ================= 交我办 =================
export async function fetchMyAccount() {
  const cookie = cookieFor('my');
  if (!cookie) throw new Error('请先粘贴交我办(my.sjtu.edu.cn)的 Cookie');
  const res = await sjtuFetch(`${HOST_MAP.my}/api/account`, { cookie });
  return await res.json();
}

export async function fetchCalendarToday() {
  const cookie = cookieFor('my');
  if (!cookie) throw new Error('请先粘贴交我办的 Cookie');
  const res = await sjtuFetch(`${HOST_MAP.my}/api/calendar/today`, { cookie });
  return await res.json();
}

export async function fetchUnreadJwb() {
  const cookie = cookieFor('my');
  if (!cookie) throw new Error('请先粘贴交我办的 Cookie');
  const res = await sjtuFetch(`${HOST_MAP.my}/api/jwbmessage/unreadNum`, { cookie });
  return await res.json();
}

// 在办流程 / 待办事项（办事大厅里未处理完的事项）
export async function fetchTodoProcesses() {
  const cookie = cookieFor('my');
  if (!cookie) throw new Error('请先粘贴交我办的 Cookie');
  const res = await sjtuFetch(`${HOST_MAP.my}/api/task/me/processes/todo`, { cookie });
  const j = await res.json();
  return (j.entities ?? []).map((e) => {
    const p = e.process ?? {};
    const rawStatus = p.status ?? e.status;
    return {
      id: String(p.entry ?? e.id ?? ''),
      title: p.app?.name || e.name || p.name || '办事事项',
      description: e.description || p.name || '',
      department: p.app?.department || '',
      status: rawStatus === 'doing' ? 'doing' : (rawStatus == null ? '' : 'pending'),
      statusText: rawStatus === 'doing' ? '办理中' : '待处理',
      percent: p.milestone?.percent ?? null,
      createdAt: p.create
        ? new Date(p.create * 1000).toISOString()
        : (e.assignTime ? new Date(e.assignTime * 1000).toISOString() : null),
      url: e.uri || p.uri || '',
    };
  });
}

// 通知汇总
export async function fetchTotalNotify() {
  const cookie = cookieFor('my');
  if (!cookie) throw new Error('请先粘贴交我办的 Cookie');
  const res = await sjtuFetch(`${HOST_MAP.my}/api/resource/getTotalNotify`, { cookie });
  return await res.json();
}

// ================= 教务：修业情况（培养方案学分模块） =================
export async function fetchStudyProgress() {
  const cookie = cookieFor('i');
  if (!cookie) throw new Error('请先在「导入与设置」粘贴教务系统 Cookie');
  const res = await sjtuFetch(`${HOST_MAP.i}/xjyj/xsxyqk_ckXsXyxxHtmlView.html?gnmkdm=N551225`, {
    cookie,
    method: 'POST',
    form: { doType: 'query', 'queryModel.showCount': '200', 'queryModel.currentPage': '1' },
  });
  const j = await readJsonOrAuthError(res, '教务');
  return j.items ?? [];
}

// "通识教育课程(45 / 2)" → { name, required, earned }
function parseCreditCell(s) {
  const text = String(s ?? '').replace(/<[^>]+>/g, '').trim();
  const m = text.match(/^(.*?)[（(]\s*([\d.]+)\s*[/／]\s*([\d.]+)\s*[)）]\s*$/);
  if (m) return { name: m[1].trim(), required: Number(m[2]), earned: Number(m[3]) };
  return { name: text, required: null, earned: null };
}

// 培养方案模块树
export function buildPlanTree(items) {
  const modules = [];
  for (const it of items ?? []) {
    const l2 = parseCreditCell(it.level2);
    if (!l2.name) continue;
    let m2 = modules.find((m) => m.name === l2.name);
    if (!m2) {
      m2 = { name: l2.name, required: l2.required, earned: l2.earned, groups: [] };
      modules.push(m2);
    }
    if (it.level3) {
      const l3 = parseCreditCell(it.level3);
      let g3 = m2.groups.find((g) => g.name === l3.name);
      if (!g3) {
        g3 = { name: l3.name, required: l3.required, earned: l3.earned, items: [] };
        m2.groups.push(g3);
      }
      if (it.level4) {
        const l4 = parseCreditCell(it.level4);
        if (l4.name && !g3.items.some((x) => x.name === l4.name)) g3.items.push(l4);
      }
    }
  }
  const totalRequired = modules.reduce((s, m) => s + (m.required ?? 0), 0);
  const totalEarned = modules.reduce((s, m) => s + (m.earned ?? 0), 0);
  return { modules, totalRequired, totalEarned };
}

// ================= 教务：考试信息 =================
export async function fetchExams({ xnm, xqm } = {}) {
  const cookie = cookieFor('i');
  if (!cookie) throw new Error('请先粘贴教务系统 Cookie');
  const t = semester();
  const res = await sjtuFetch(`${HOST_MAP.i}/kwgl/kscx_cxXsksxxIndex.html?gnmkdm=N358105`, {
    cookie,
    method: 'POST',
    form: {
      doType: 'query',
      cx_xnm: xnm ?? t.xnm,
      cx_xqm: xqm ?? t.xqm,
      'queryModel.showCount': '100',
      'queryModel.currentPage': '1',
    },
  });
  const j = await readJsonOrAuthError(res, '教务');
  return j.items ?? [];
}

// 考试记录 → 统一结构（字段名宽容匹配）
export function mapExams(items) {
  const pick = (o, keys) => {
    for (const k of keys) if (o[k] != null && o[k] !== '') return o[k];
    return '';
  };
  return (items ?? []).map((it) => {
    const course = pick(it, ['kcmc', 'kcbmc', 'kch']);
    const date = pick(it, ['ksrq', 'ksrqStr', 'kssj', 'ksnyr']);
    const time = pick(it, ['kssj', 'kssjmc', 'kssjStr']);
    const place = pick(it, ['cdmc', 'jsmc', 'ksdd', 'kscdmc']);
    const name = pick(it, ['ksmcmc', 'ksmc', 'ksxsmc']) || '考试';
    return {
      course: String(course).trim(),
      title: `${String(course).trim() || '课程'} · ${name}`,
      date: String(date).trim(),
      time: String(time).trim(),
      place: String(place).trim(),
      raw: it,
    };
  });
}

// ================= 图书馆（空间/座位预约） =================
const PLAIN_UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/150' };

async function plainGetJson(url) {
  const res = await fetch(url, { headers: PLAIN_UA });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

// 图书馆座位/空间实时状态（实测无需登录）
export async function fetchLibrarySeats() {
  const out = { status: null, menus: [], roomMenus: [], news: [] };
  const withBase = (p) => 'https://libspace.sjtu.edu.cn' + p;
  try { out.status = (await plainGetJson(withBase('/ic-web/seatDevice/resvStatus'))).data; } catch { /* 忽略 */ }
  try { out.menus = (await plainGetJson(withBase('/ic-web/seatMenu'))).data ?? []; } catch { /* 忽略 */ }
  try { out.roomMenus = (await plainGetJson(withBase('/ic-web/roomMenu'))).data ?? []; } catch { /* 忽略 */ }
  try { out.news = (await plainGetJson(withBase('/ic-web/news'))).data ?? []; } catch { /* 忽略 */ }
  if (!out.status && out.menus.length === 0) throw new Error('图书馆接口暂时无响应');
  return out;
}

export async function fetchLibraryRooms() {
  const cookie = cookieFor('lib') || cookieFor('libspace');
  if (!cookie) throw new Error('请先粘贴图书馆 libspace.sjtu.edu.cn 的 Cookie');
  const res = await sjtuFetch('https://libspace.sjtu.edu.cn/ic-web/roomDevice/roomInfos', { cookie });
  return await res.json();
}

export async function fetchLibraryPunish() {
  const cookie = cookieFor('lib') || cookieFor('libspace');
  if (!cookie) throw new Error('请先粘贴图书馆 Cookie');
  const res = await sjtuFetch('https://libspace.sjtu.edu.cn/ic-web/reserve/punishInfo', { cookie });
  return await res.json();
}

// ================= 宿舍电费 =================
export async function fetchElectricity() {
  const cookie = cookieFor('elec');
  if (!cookie) throw new Error('请先粘贴电费 elec.sjtu.edu.cn 的 Cookie');
  const out = { room: null, remain: null, monthly: null };
  const info = await sjtuFetch('https://elec.sjtu.edu.cn/api/me/info', { cookie });
  out.room = await info.json();
  try {
    const r = await sjtuFetch('https://elec.sjtu.edu.cn/api/ws/sydl', { cookie });
    out.remain = await r.json();
  } catch { /* 忽略 */ }
  return out;
}

// ================= 第二课堂 =================
export async function fetchDekt() {
  const cookie = cookieFor('dekt');
  if (!cookie) throw new Error('请先粘贴第二课堂 dektcjd.sjtu.edu.cn 的 Cookie');
  const out = {};
  const eps = {
    basic: '/basicInformation/getBasic',
    honor: '/personalHonor/getHonor',
    voluntary: '/voluntaryPracticeInfo/getInfo',
    labor: '/student/education/labor',
  };
  for (const [k, p] of Object.entries(eps)) {
    try {
      const r = await sjtuFetch('https://dektcjd.sjtu.edu.cn' + p, { cookie });
      out[k] = await r.json();
    } catch (e) {
      out[k] = { error: e.message };
    }
  }
  return out;
}

// ================= Canvas（Cookie 模式 / Token 模式） =================
export function canvasAuth() {
  const s = getSettings();
  return {
    base: (s.canvasUrl || HOST_MAP.oc).replace(/\/+$/, ''),
    token: String(s.canvasToken ?? '').trim(),
    cookie: cookieFor('oc'),
  };
}
