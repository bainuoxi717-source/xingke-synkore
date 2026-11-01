// 课表文件解析：支持 Excel(xlsx/xls) 与 CSV
// 两种常见布局：
//   1) 平铺表：一行一节课（课程/教师/星期/节次/周次/地点）
//   2) 网格表：行=节次，列=周一到周日，单元格=课程信息
import XLSX from 'xlsx';
import { courseColorFor } from './canvas.js';

// 上课节次时间（分钟，距 0:00）—— 上海交通大学官方作息表
// 来源：交大电院《上海交通大学学生上课时间表》
// 1-4节 上午 / 5-6节 午间 / 7-10节 下午 / 11-13节 晚上（18:00-20:20 连上）
export const SECTION_START = {
  1: 480,   // 08:00-08:45
  2: 535,   // 08:55-09:40
  3: 600,   // 10:00-10:45
  4: 655,   // 10:55-11:40
  5: 720,   // 12:00-12:45
  6: 775,   // 12:55-13:40
  7: 840,   // 14:00-14:45
  8: 895,   // 14:55-15:40
  9: 960,   // 16:00-16:45
  10: 1015, // 16:55-17:40
  11: 1080, // 18:00-18:45
  12: 1135, // 18:55-19:40
  13: 1180, // 19:40-20:25（11-13 连上至 20:20）
  14: 1235,
};
export const CLASS_MIN = 45;

export function secStart(s) {
  return SECTION_START[s] ?? null;
}

export function parseDay(v) {
  const s = String(v ?? '').trim();
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return n >= 1 && n <= 7 ? n : null;
  }
  const m = s.match(/^周?[日天一二三四五六1-7]$/);
  if (m) {
    const c = s.replace('周', '');
    const map = { 日: 7, 天: 7, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
    if (map[c] != null) return map[c];
    const n = Number(c);
    if (n >= 1 && n <= 7) return n;
  }
  const m2 = s.match(/星期([日天一二三四五六1-7])|周([日天一二三四五六1-7])/);
  if (m2) return parseDay(m2[1] ?? m2[2]);
  return null;
}

export function parseWeeks(v) {
  const s = String(v ?? '').replace(/周|星期/g, '').replace(/（/g, '(').replace(/）/g, ')').trim();
  let parity = 0;
  if (/单/.test(s)) parity = 1;
  else if (/双/.test(s)) parity = 2;
  const list = [];
  const m = s.match(/\(?([\d,\s\-~—、]+)\)?/);
  const body = m ? m[1] : s;
  for (const part of body.split(/[、,，]/)) {
    const p = part.trim();
    if (!p) continue;
    if (/^\d+$/.test(p)) list.push(p);
    else if (/^\d+\s*[-~—]\s*\d+$/.test(p)) list.push(p.replace(/\s+/g, ''));
  }
  return { weeks: list.join(','), parity };
}

export function parseSections(v) {
  const s = String(v ?? '').trim().replace(/节/g, '');
  if (!s) return null;
  const range = s.match(/^(\d{1,2})\s*[-~—至]\s*(\d{1,2})$/);
  if (range) return { start: Number(range[1]), end: Number(range[2]) };
  const multi = s.match(/^(\d{1,2})\s*[,，]\s*(\d{1,2})$/);
  if (multi) {
    const a = Number(multi[1]), b = Number(multi[2]);
    return { start: Math.min(a, b), end: Math.max(a, b) };
  }
  const single = s.match(/^(\d{1,2})$/);
  if (single) return { start: Number(single[1]), end: Number(single[1]) };
  return null;
}

function readRows(buf, fileName) {
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  if (ext === 'csv' || ext === 'txt') {
    const wb = XLSX.read(buf.toString('utf8'), { type: 'string' });
    return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: true });
  }
  const wb = XLSX.read(buf, { type: 'buffer' });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: true });
}

const DAY_CELL = (c) => parseDay(c) != null && /周|星期|礼拜|[一二三四五六日天]/.test(String(c));

function detectMode(rows) {
  // 网格表：表头行含多个「周X」，且左侧有节次列
  for (const row of rows) {
    const days = row.filter(DAY_CELL).length;
    if (days >= 3) {
      const firstCol = row.slice(0, Math.max(1, row.length - days)).join(' ');
      const hasSections = rows.some((r) => /第?\s*\d+\s*节/.test(String(r[0] ?? '')));
      if (hasSections || /节|时间/.test(firstCol)) return 'grid';
    }
  }
  return 'flat';
}

// ---------- 平铺表解析 ----------
function parseFlat(rows) {
  const courses = new Map();
  const slots = [];
  const warnings = [];

  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const joined = rows[i].map((c) => String(c ?? '')).join('|');
    if (/课程|科目|名称/.test(joined) && (/星期|周几|节次/.test(joined))) { headerIdx = i; break; }
  }
  if (headerIdx < 0) {
    const err = new Error('未识别出表头（需要包含「课程名 + 星期/周几 + 节次」等列）');
    throw err;
  }
  const header = rows[headerIdx].map((c) => String(c ?? '').trim());
  const col = (re) => header.findIndex((h) => re.test(h));
  const cName = col(/课程名|课程|科目/);
  const cTeacher = col(/教师|老师/);
  const cDay = col(/星期|周几|礼拜/);
  const cStartSec = col(/起始节|开始节|起节/);
  const cEndSec = col(/结束节|终止节|止节/);
  const cSections = col(/^节次$|节次/);
  const cWeeks = col(/周次|周数/);
  const cLoc = col(/地点|教室|场地/);
  const cCredit = col(/学分/);

  if (cName < 0 || (cDay < 0 && cSections < 0)) {
    throw new Error('表头缺少必要列：课程名 / 星期 / 节次');
  }

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const name = String(r[cName] ?? '').trim();
    if (!name) continue;
    const teacher = cTeacher >= 0 ? String(r[cTeacher] ?? '').trim() : '';
    const day = cDay >= 0 ? parseDay(r[cDay]) : null;
    let secs = null;
    if (cStartSec >= 0 && cEndSec >= 0) {
      secs = { start: Number(r[cStartSec]), end: Number(r[cEndSec]) };
    } else if (cSections >= 0) {
      secs = parseSections(r[cSections]);
    }
    const wk = cWeeks >= 0 ? parseWeeks(r[cWeeks]) : { weeks: '', parity: 0 };
    const location = cLoc >= 0 ? String(r[cLoc] ?? '').trim() : '';
    const credits = cCredit >= 0 ? Number(r[cCredit]) || 0 : 0;

    if (day == null) { warnings.push(`第 ${i + 1} 行：星期无法识别（${r[cDay]}），已跳过`); continue; }
    if (!secs) { warnings.push(`第 ${i + 1} 行：节次无法识别，已跳过`); continue; }
    const startMin = secStart(secs.start);
    const endMin = secStart(secs.end);
    if (startMin == null || endMin == null) { warnings.push(`第 ${i + 1} 行：节次超出范围，已跳过`); continue; }

    if (!courses.has(name)) courses.set(name, { name, teacher, credits });
    slots.push({
      course_name: name, day_of_week: day, start_min: startMin, end_min: endMin + CLASS_MIN,
      weeks: wk.weeks, week_parity: wk.parity, location,
    });
  }
  return { courses: [...courses.values()], slots, warnings, mode: 'flat' };
}

// ---------- 网格表解析 ----------
function parseGrid(rows) {
  const courses = new Map();
  const slots = [];
  const warnings = [];

  // 找表头行（含周几）
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    if (rows[i].filter(DAY_CELL).length >= 3) { headerIdx = i; break; }
  }
  if (headerIdx < 0) throw new Error('未识别出网格表头（需要「周一…周日」列）');

  const header = rows[headerIdx].map((c) => String(c ?? '').trim());
  const dayCols = [];
  header.forEach((h, idx) => {
    const d = parseDay(h);
    if (d != null) dayCols.push({ idx, day: d });
  });
  if (dayCols.length === 0) throw new Error('表头未找到星期列');

  // 找节次行：每行第一列含「第N节 / N-M节 / 时间」
  const secRows = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const first = String(rows[i][0] ?? '').trim();
    if (!first) continue;
    let secs = parseSections(first.replace('第', ''));
    if (secs) secRows.push({ rowIdx: i, ...secs });
    else {
      const t = first.match(/(\d{1,2}):(\d{2})\s*[-~—]\s*(\d{1,2}):(\d{2})/);
      if (t) {
        const s = Number(t[1]) * 60 + Number(t[2]);
        const e = Number(t[3]) * 60 + Number(t[4]);
        // 按 45 分钟映射到节次
        const ss = Math.max(1, Math.round((s - 480) / 55) + 1);
        const es = Math.max(ss, Math.round((e - 480 - 45) / 55) + 1);
        secRows.push({ rowIdx: i, start: ss, end: es });
      }
    }
  }
  if (secRows.length === 0) throw new Error('未找到节次行（第一列应为「第N节」或时间）');

  // 逐单元格解析并合并连续节次
  for (const dc of dayCols) {
    let prev = null; // {name, startSec, endSec, ...}
    const flush = () => {
      if (!prev) return;
      const sMin = secStart(prev.startSec);
      const eMin = secStart(prev.endSec);
      if (sMin != null && eMin != null) {
        if (!courses.has(prev.name)) courses.set(prev.name, { name: prev.name, teacher: prev.teacher, credits: 0 });
        slots.push({
          course_name: prev.name, day_of_week: dc.day, start_min: sMin, end_min: eMin + CLASS_MIN,
          weeks: prev.weeks, week_parity: prev.parity, location: prev.location,
        });
      }
      prev = null;
    };
    for (const sr of secRows) {
      const cell = String(rows[sr.rowIdx][dc.idx] ?? '').trim();
      if (!cell) { flush(); continue; }
      const info = parseGridCell(cell);
      if (!info) { flush(); continue; }
      if (prev && prev.name === info.name && prev.endSec + 1 === sr.start) {
        prev.endSec = sr.end;
      } else {
        flush();
        prev = { ...info, startSec: sr.start, endSec: sr.end };
      }
    }
    flush();
  }
  return { courses: [...courses.values()], slots, warnings, mode: 'grid' };
}

function parseGridCell(cell) {
  const lines = cell.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  const name = lines[0].replace(/@.*$/, '').trim();
  if (!name || /节|午|晚|自习/.test(name)) return null;
  let teacher = '';
  let location = '';
  for (const l of lines) {
    const tm = l.match(/(?:教师|老师|讲师)[:：]?\s*([^\s@（）()]+)/);
    if (tm) teacher = tm[1].replace(/教师|老师|讲师/g, '');
    if (/楼|室|馆|教\d/.test(l) && l !== lines[0]) location = l.replace(/@/, '').trim();
  }
  const wk = parseWeeks(cell);
  return { name, teacher, location, weeks: wk.weeks, parity: wk.parity };
}

// ---------- 入口 ----------
export function parseScheduleFile(fileName, dataBase64) {
  const buf = Buffer.from(dataBase64, 'base64');
  const rows = readRows(buf, fileName);
  const mode = detectMode(rows);
  const result = mode === 'grid' ? parseGrid(rows) : parseFlat(rows);
  // 给课程上色
  const colors = new Map();
  result.courses.forEach((c, i) => {
    c.color = courseColorFor(i);
    colors.set(c.name, c.color);
  });
  if (result.slots.length === 0) {
    throw new Error('没有解析出任何课程时段。请检查文件是否为课表（或截图 — 截图请直接发到对话，我用 OCR 处理）');
  }
  return result;
}
