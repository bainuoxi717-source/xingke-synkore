// 课次自动读取：课后抓取平台已有的 PPT、回放字幕与摘要，准备笔记任务。
// 本流程不调用付费 AI；笔记生成由用户核对具体课次与用量后单独启动。
//
// 设计要点：
//   ① 以「课是否已结束」为触发条件（录播需要一点处理时间，默认课后 25 分钟才认为可取）
//   ② 增量抓取：只处理「库里没有」或「抓得不全」的课次，正常一轮只花几次列表请求
//   ③ 与课表联动：可以传入某一天/某门课，只为刚下课的那门课做检查
import { q, q1, run, nowISO, getSettings } from '../db.js';
import { acquireVideoToken, listVodCourses, listLectures, getTranscript, getSummary, getPptSlices } from './video.js';
import { planLectureNotes, listNoteTasks } from './distill.js';

// 录播处理延迟：课后多久才认为平台已经处理完
const READY_DELAY_MIN = 25;

const minsSince = (iso) => {
  const t = new Date(String(iso).replace(' ', 'T')).getTime();
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / 60000;
};

// 这节课需不需要抓？（缺字幕 / 缺 PPT / 缺总结 / 库里没有）
// 规则：一周内的课允许反复重试（平台的 AI 转写与 PPT 切片需要时间生成），
//       超过一周还缺就认为平台确实没有，停止纠缠。
const RETRY_WINDOW_MIN = 7 * 24 * 60;

function needsFetch(lec, row) {
  if (!row) return true;
  const ageMin = minsSince(lec.beginTime);
  if ((row.transcript ?? '').length <= 50) return true;            // 缺字幕 → 必抓
  const fresh = ageMin < RETRY_WINDOW_MIN;
  if (fresh && (row.ppt_json ?? '').length <= 5) return true;      // PPT 可能还在生成
  if (fresh && (row.summary_json ?? '').length <= 5) return true;  // AI 总结可能还在生成
  return false;
}

// 主流程：扫描并增量抓取
// opts: { sinceDays = 30, force = false, onlySubjects = [], onProgress = fn }
export async function ingestNewLectures(opts = {}) {
  const { sinceDays = 30, force = false, onlySubjects = [], onProgress = () => {} } = opts;
  const report = { scanned: 0, ready: 0, added: 0, updated: 0, skipped: 0, failed: 0, chars: 0, queued: 0, distilled: 0, items: [], errors: [] };

  await acquireVideoToken();
  const courses = await listVodCourses();
  const cutoff = Date.now() - sinceDays * 24 * 60 * 60 * 1000;

  for (const c of courses) {
    if (onlySubjects.length && !onlySubjects.includes(c.subjName)) continue;
    let lects = [];
    try { lects = await listLectures(c.teclId); }
    catch (e) { report.errors.push({ subject: c.subjName, error: e.message }); continue; }

    for (const lec of lects) {
      report.scanned++;
      const begin = new Date(String(lec.beginTime).replace(' ', 'T')).getTime();
      // ① 太老的跳过（避免全量重扫）
      if (!force && begin < cutoff) { report.skipped++; continue; }
      // ② 课还没上完 / 刚下课平台还没处理完 → 跳过，等下一轮
      const endGuess = lec.endTime ? lec.endTime : lec.beginTime;
      if (minsSince(endGuess) < READY_DELAY_MIN) { report.skipped++; continue; }
      // ③ 已经有了且抓全了 → 跳过
      const row = q1('SELECT cour_id, transcript, ppt_json, summary_json FROM lectures WHERE cour_id = ?', lec.courId);
      if (!force && !needsFetch(lec, row)) { report.skipped++; continue; }

      report.ready++;
      try {
        const [tr, sum, ppt] = await Promise.all([
          getTranscript(lec.courId),
          getSummary(lec.courId),
          getPptSlices(lec.courId),
        ]);
        const chars = tr.text?.length ?? 0;
        const local = q1('SELECT id FROM courses WHERE name = ? OR name = ? LIMIT 1', lec.subjName, c.subjName);
        run(
          `INSERT INTO lectures (cour_id, tecl_id, course_id, subj_code, subj_name, teacher, week_no, leti_number, room,
             begin_time, end_time, shot_url, transcript, transcript_json, summary_json, ppt_json, watched_percent, fetched_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(cour_id) DO UPDATE SET
             transcript = excluded.transcript, transcript_json = excluded.transcript_json,
             summary_json = excluded.summary_json, ppt_json = excluded.ppt_json,
             watched_percent = excluded.watched_percent, fetched_at = excluded.fetched_at`,
          lec.courId, lec.teclId, local?.id ?? null, lec.subjCode, lec.subjName || c.subjName,
          lec.teacher || c.teachers, lec.weekNo, lec.letiNumber, lec.room, lec.beginTime, lec.endTime, lec.shotUrl,
          tr.text ?? '', JSON.stringify(tr.segments ?? []),
          sum ? JSON.stringify(sum) : '', JSON.stringify(ppt ?? []),
          lec.watchedPercent ?? 0, nowISO()
        );
        report.chars += chars;
        if (row) report.updated++; else report.added++;
        const item = {
          subject: lec.subjName || c.subjName, teacher: lec.teacher || c.teachers,
          beginTime: lec.beginTime, leti: lec.letiNumber, isNew: !row,
          chars, ppt: ppt.length, summary: !!(sum && !sum.error),
        };
        report.items.push(item);
        onProgress(item);

        // Reading a new lecture makes it visible in the derived preparation queue.
        // Even a legacy autoDistill:true option cannot authorize paid generation.
        const task = planLectureNotes(lec.courId);
        item.noteStatus = task.status;
        item.noteStatusLabel = task.statusLabel;
        item.notesQueued = Boolean(task.readyToGenerate && ['pending', 'stale', 'error'].includes(task.status));
        if (item.notesQueued) report.queued++;
      } catch (e) {
        report.failed++;
        report.errors.push({ subject: lec.subjName || c.subjName, beginTime: lec.beginTime, error: e.message });
      }
    }
  }
  report.noteTasks = listNoteTasks({ limit: 1 }).counts;
  return report;
}

// 本学期当前教学周
function currentWeekNumber() {
  const s = getSettings();
  if (!s.termStart) return 1;
  const start = new Date(s.termStart + 'T00:00:00');
  if (Number.isNaN(start.getTime())) return 1;
  const diff = Math.floor((Date.now() - start.getTime()) / 86400000);
  return diff < 0 ? 1 : Math.floor(diff / 7) + 1;
}

// 判断某周是否命中课表的 weeks 规则（如 "1-16" / "1,3,5" / "2-16"）
function weekMatches(weeks, parity, week) {
  if (weeks && weeks !== '') {
    const ok = String(weeks).split(',').some((part) => {
      const m = part.trim().match(/^(\d+)\s*-\s*(\d+)$/);
      if (m) return week >= Number(m[1]) && week <= Number(m[2]);
      return Number(part.trim()) === week;
    });
    if (!ok) return false;
  }
  if (Number(parity) === 1 && week % 2 === 0) return false;   // 单周
  if (Number(parity) === 2 && week % 2 === 1) return false;   // 双周
  return true;
}

// 根据课表算出「今天已经下课、且录播该出来了」的课程 —— 用于精准触发抓取
export function endedTodaySubjects() {
  const now = new Date();
  const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const isoDay = now.getDay() === 0 ? 7 : now.getDay();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const week = currentWeekNumber();

  const slots = q(`SELECT s.*, c.name AS course_name, c.teacher
                   FROM schedule_slots s JOIN courses c ON c.id = s.course_id
                   WHERE s.day_of_week = ?`, isoDay).filter((s) => weekMatches(s.weeks, s.week_parity, week));

  // 已下课（留出处理延迟），且本周有这个时段
  const ended = slots.filter((s) => nowMin - Number(s.end_min) >= READY_DELAY_MIN);
  const upcoming = slots.filter((s) => nowMin - Number(s.end_min) < READY_DELAY_MIN);
  const ingested = q(`SELECT DISTINCT subj_name, begin_time FROM lectures WHERE begin_time LIKE ?`, `${ymd}%`);

  return {
    date: ymd, week, nowMin,
    endedCount: ended.length,
    ended: ended.map((s) => ({ subject: s.course_name, teacher: s.teacher, end: `${String(Math.floor(s.end_min / 60)).padStart(2, '0')}:${String(s.end_min % 60).padStart(2, '0')}`, room: s.location })),
    pending: upcoming.map((s) => ({ subject: s.course_name, teacher: s.teacher, end: `${String(Math.floor(s.end_min / 60)).padStart(2, '0')}:${String(s.end_min % 60).padStart(2, '0')}`, room: s.location })),
    ingestedToday: ingested,
  };
}

// 今天还有几节课没结束（决定要不要更频繁地轮询）
export function pendingTodayCount() {
  const now = new Date();
  const isoDay = now.getDay() === 0 ? 7 : now.getDay();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const week = currentWeekNumber();
  return q(`SELECT s.* FROM schedule_slots s WHERE s.day_of_week = ?`, isoDay)
    .filter((s) => weekMatches(s.weeks, s.week_parity, week))
    .filter((s) => Number(s.end_min) > nowMin).length;
}

// 内化状态总览
export function ingestStatus() {
  const row = q1(`SELECT COUNT(*) AS total,
                         SUM(CASE WHEN LENGTH(transcript) > 50 THEN 1 ELSE 0 END) AS withTranscript,
                         SUM(CASE WHEN LENGTH(ppt_json) > 5 THEN 1 ELSE 0 END) AS withPpt,
                         SUM(CASE WHEN LENGTH(summary_json) > 5 THEN 1 ELSE 0 END) AS withSummary,
                         SUM(LENGTH(transcript)) AS chars,
                         MAX(begin_time) AS latest
                  FROM lectures`);
  const pending = q1(`SELECT COUNT(*) AS n FROM lectures
                      WHERE LENGTH(transcript) <= 50 OR LENGTH(ppt_json) <= 5`)?.n ?? 0;
  return { ...row, pending, lastCheck: nowISO() };
}
