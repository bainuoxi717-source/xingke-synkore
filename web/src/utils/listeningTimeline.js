import { getShanghaiWeek, slotsForWeek, dateStamp, minutesLabel } from './weekSchedule.js';

export const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
export function formatRecordingTime(milliseconds = 0) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  return `${hours ? `${String(hours).padStart(2, '0')}:` : ''}${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
const atMinute = (date, minute) => Date.parse(`${date}T${minutesLabel(minute)}:00+08:00`);

// Use the timetable's actual section boundaries, rather than assuming every lesson is 45+10 minutes.
export function lessonSegments(start, end, periods = []) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const classes = periods.filter((p) => Number.isFinite(p.start) && Number.isFinite(p.end) && p.end > p.start)
    .map((p) => ({ start: Math.max(start, p.start), end: Math.min(end, p.end), number: p.number }))
    .filter((p) => p.end > p.start).sort((a, b) => a.start - b.start);
  if (!classes.length) return [{ kind: 'class', start, end, label: '课堂', inferred: true }];
  const parts = [];
  let cursor = start;
  for (const part of classes) {
    if (part.start > cursor) parts.push({ kind: 'break', start: cursor, end: part.start, label: '课间' });
    const from = Math.max(cursor, part.start);
    if (part.end > from) parts.push({ ...part, kind: 'class', start: from, label: `第${part.number}小节` });
    cursor = Math.max(cursor, part.end);
  }
  if (cursor < end) parts.push({ kind: 'break', start: cursor, end, label: '课间' });
  return parts;
}
export function makeScheduledLesson(slot, date, periods) {
  const segments = lessonSegments(Number(slot.start_min), Number(slot.end_min), periods);
  return { key: `${date}:${slot.id}`, slotId: slot.id, courseId: slot.course_id, date,
    title: slot.course_name || '课堂', startAt: atMinute(date, Number(slot.start_min)), endAt: atMinute(date, Number(slot.end_min)),
    startMinute: Number(slot.start_min), endMinute: Number(slot.end_min),
    segments: segments.map((part) => ({ ...part, startAt: atMinute(date, part.start), endAt: atMinute(date, part.end) })),
    source: 'schedule', breaksKnown: !segments.some((part) => part.inferred),
  };
}
export function upcomingLessons(data, now = new Date()) {
  if (!data?.slots || !data?.semester) return { lessons: [], configured: false };
  const calendar = getShanghaiWeek(now);
  const lessons = [];
  let configured = false;
  // Today plus six days: retain today's ended lessons so they can still be recorded explicitly.
  for (let offset = 0; offset < 7; offset++) {
    const date = new Date(dateStamp(calendar.today) + offset * 86400000).toISOString().slice(0, 10);
    const dayCalendar = getShanghaiWeek(new Date(`${date}T12:00:00+08:00`));
    const week = slotsForWeek(data.slots, data.semester, dayCalendar);
    if (week.state === 'active') configured = true;
    for (const slot of week.days.find((day) => day.date === date)?.slots || []) lessons.push(makeScheduledLesson(slot, date, data.periods || []));
  }
  lessons.sort((a, b) => a.startAt - b.startAt || String(a.key).localeCompare(String(b.key)));
  return { lessons, configured };
}
export function classTimelineLessons(data, now = new Date()) {
  if (!data?.slots || !data?.semester) return [];
  const today = getShanghaiWeek(now).today, lessons = [];
  for (let offset = -7; offset <= 6; offset++) {
    const date = new Date(dateStamp(today) + offset * 86400000).toISOString().slice(0, 10);
    const calendar = getShanghaiWeek(new Date(`${date}T12:00:00+08:00`));
    const week = slotsForWeek(data.slots, data.semester, calendar);
    for (const slot of week.days.find((day) => day.date === date)?.slots || []) lessons.push(makeScheduledLesson(slot, date, data.periods || []));
  }
  return lessons.sort((a, b) => a.startAt - b.startAt);
}
export function chooseLesson(lessons, now = Date.now()) {
  return lessons.find((lesson) => lesson.startAt <= now && lesson.endAt > now)
    || lessons.find((lesson) => lesson.startAt > now)
    || lessons.at(-1) || null;
}
export function makeFreeLesson(now = Date.now(), minutes = 45) {
  const duration = clamp(Number(minutes) || 45, 5, 240) * 60000;
  return { key: 'free', title: '自由听课', source: 'free', startAt: now, endAt: now + duration,
    date: getShanghaiWeek(new Date(now)).today, breaksKnown: false,
    segments: [{ kind: 'class', label: '自由听课', startAt: now, endAt: now + duration }],
  };
}
export function lessonProgress(lesson, now = Date.now()) {
  if (!lesson) return { ratio: 0, state: 'idle', segment: null, remainingMs: 0 };
  const state = now < lesson.startAt ? 'upcoming' : now >= lesson.endAt ? 'ended' : 'active';
  const segment = lesson.segments?.find((part) => part.startAt <= now && part.endAt > now) || null;
  return { ratio: clamp((now - lesson.startAt) / (lesson.endAt - lesson.startAt)), state,
    segment, remainingMs: Math.max(0, (segment?.endAt || lesson.endAt) - now) };
}
export function lessonDurations(lesson) {
  const total = lesson ? Math.round((lesson.endAt - lesson.startAt) / 60000) : 0;
  const breaks = (lesson?.segments || []).filter((part) => part.kind === 'break').reduce((sum, part) => sum + (part.endAt - part.startAt) / 60000, 0);
  return { total, breaks: Math.round(breaks), classes: total - Math.round(breaks) };
}
export function wallTime(value) {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}
