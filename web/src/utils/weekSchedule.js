const DAY_MS = 86400000;
export const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const shanghaiDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
});

// Use UTC only as a civil-date arithmetic container, never as the displayed timezone.
export function dateStamp(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return null;
  const [year, month, day] = value.split('-').map(Number);
  const stamp = Date.UTC(year, month - 1, day);
  return new Date(stamp).toISOString().slice(0, 10) === value ? stamp : null;
}

export function getShanghaiWeek(now = new Date()) {
  const parts = Object.fromEntries(shanghaiDate.formatToParts(now).map(({ type, value }) => [type, value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const stamp = dateStamp(today);
  const todayIndex = (new Date(stamp).getUTCDay() + 6) % 7;
  const monday = stamp - todayIndex * DAY_MS;
  const days = WEEKDAYS.map((name, index) => {
    const date = new Date(monday + index * DAY_MS);
    return { name, index, date: date.toISOString().slice(0, 10), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
  });
  return { today, todayIndex, monday: days[0].date, sunday: days[6].date, days };
}

export function getTeachingWeek(semester, monday) {
  const start = dateStamp(semester?.firstWeekMonday);
  const current = dateStamp(monday);
  if (start == null || current == null || new Date(start).getUTCDay() !== 1) {
    return { week: null, state: 'unconfigured' };
  }
  const week = Math.floor((current - start) / (7 * DAY_MS)) + 1;
  const total = Number(semester.totalWeeks);
  if (week < 1) return { week, state: 'before-term' };
  if (Number.isFinite(total) && total > 0 && week > total) return { week, state: 'after-term' };
  return { week, state: 'active' };
}

export function isInTeachingWeek(slot, week) {
  if (!Number.isInteger(week) || week < 1) return false;
  const parity = Number(slot.week_parity || 0);
  if (parity === 1 && week % 2 !== 1) return false;
  if (parity === 2 && week % 2 !== 0) return false;
  const raw = String(slot.weeks || '').trim();
  if (!raw) return true;
  // The importer stores 1-16 or 1,3,5; tolerate localized commas and range marks.
  const ranges = raw.replace(/[，、；;]/g, ',').replace(/[～~–—至]/g, '-').replace(/周/g, '').split(',');
  return ranges.some((part) => {
    const range = part.trim().match(/^(\d+)\s*(?:-\s*(\d+))?$/);
    if (!range) return false;
    const from = Number(range[1]);
    const to = Number(range[2] || range[1]);
    return week >= from && week <= to;
  });
}

export function slotsForWeek(slots, semester, calendar) {
  const teaching = getTeachingWeek(semester, calendar.monday);
  const valid = teaching.state === 'active' ? slots.filter((slot) => {
    const day = Number(slot.day_of_week);
    const start = Number(slot.start_min);
    const end = Number(slot.end_min);
    return day >= 1 && day <= 7 && Number.isInteger(day)
      && Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start && end <= 1440
      && isInTeachingWeek(slot, teaching.week);
  }).sort((a, b) => Number(a.start_min) - Number(b.start_min)) : [];
  return { ...teaching, slots: valid, days: calendar.days.map((day) => ({ ...day, slots: valid.filter((slot) => Number(slot.day_of_week) === day.index + 1) })) };
}

export function minutesLabel(value) {
  const minutes = Number(value);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function weekRangeLabel(calendar) {
  const first = calendar.days[0];
  const last = calendar.days[6];
  const firstYear = first.date.slice(0, 4);
  const lastYear = last.date.slice(0, 4);
  return firstYear === lastYear
    ? `${firstYear} 年 ${first.month} 月 ${first.day} 日 — ${last.month} 月 ${last.day} 日`
    : `${firstYear}.${first.month}.${first.day} — ${lastYear}.${last.month}.${last.day}`;
}
