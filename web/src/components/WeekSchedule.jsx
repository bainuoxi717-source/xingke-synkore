import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, MapPin, UserRound, RefreshCw, ArrowUpRight, Coffee, CircleAlert } from 'lucide-react';
import { getShanghaiWeek, slotsForWeek, minutesLabel, weekRangeLabel } from '../utils/weekSchedule.js';
import '../learning-panels.css';
import { displayCourse, displayTeacher, displayLocation } from '../utils/showcasePrivacy.js';

const EN_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const CONFIG_MESSAGES = {
  unconfigured: ['还需要确认学期起始日期', '在设置中填写「开学第 1 周周一日期」，这里就能准确显示单双周与本周课程。'],
  'before-term': ['新学期还未开始', '本周不在已设置的教学时间内，暂不展示课程。'],
  'after-term': ['已超出当前学期的教学周', '如已进入新学期，请更新学期起始日期和总周数。'],
};

export default function WeekSchedule() {
  const [now, setNow] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState(() => getShanghaiWeek().todayIndex);
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('loading');
  const [attempt, setAttempt] = useState(0);
  const calendar = useMemo(() => getShanghaiWeek(now), [now]);
  const schedule = useMemo(() => data ? slotsForWeek(data.slots, data.semester, calendar) : null, [data, calendar]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => { setSelectedDay(calendar.todayIndex); }, [calendar.today]);
  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    const read = async (url) => {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error('无法读取课表');
      return response.json();
    };
    Promise.all([read('/api/schedule'), read('/api/context')]).then(([slots, context]) => {
      if (!Array.isArray(slots) || !context?.semester) throw new Error('课表数据格式不完整');
      // Retain only the semester fields needed here, not the rest of the context response.
      const { name, firstWeekMonday, totalWeeks } = context.semester;
      setData({ slots, semester: { name, firstWeekMonday, totalWeeks } });
      setNow(new Date());
      setStatus('ready');
    }).catch((error) => {
      if (error.name !== 'AbortError') setStatus('error');
    });
    return () => controller.abort();
  }, [attempt]);

  const explanation = schedule ? CONFIG_MESSAGES[schedule.state] : null;
  return <section className="week-schedule" aria-labelledby="week-schedule-title" aria-busy={status === 'loading'}>
    <header className="week-schedule-header">
      <div className="week-schedule-heading"><span className="week-calendar-icon"><CalendarDays size={20} strokeWidth={1.5} /></span><div><span className="week-eyebrow">YOUR WEEK, AT A GLANCE</span><h2 id="week-schedule-title">我的本周课表</h2></div></div>
      <div className="week-schedule-actions"><span className="week-date-range">{weekRangeLabel(calendar)}</span><button type="button" className="week-refresh" onClick={() => setAttempt((n) => n + 1)} disabled={status === 'loading'} title="重新读取本地课表" aria-label="重新读取本地课表"><RefreshCw size={15} className={status === 'loading' ? 'spin' : ''} /></button></div>
    </header>
    <div className="week-schedule-meta"><span>{data?.semester.name || '本周学习安排'}</span>{status === 'ready' && schedule.state === 'active' && <><span className="week-meta-divider" /><span className="week-number">第 {schedule.week} 教学周</span><span className="week-meta-divider" /><span>本周 {schedule.slots.length} 个上课时段</span></>}<span className="week-timezone">北京时间</span></div>

    {status === 'loading' ? <div className="week-schedule-state" role="status"><RefreshCw className="spin" size={23} /><h3>正在整理你的本周课表</h3><p>读取课程时间，并核对教学周与单双周。</p></div>
      : status === 'error' ? <div className="week-schedule-state" role="status"><CircleAlert size={25} /><h3>暂时无法读取课表</h3><p>请确认本地服务已启动，再重新读取。</p><button onClick={() => setAttempt((n) => n + 1)}>重新读取 <RefreshCw size={14} /></button></div>
      : explanation ? <div className="week-schedule-state"><CalendarDays size={25} /><h3>{explanation[0]}</h3><p>{explanation[1]}</p><Link to="/settings">查看学期设置 <ArrowUpRight size={14} /></Link></div>
      : <>
        <div className="week-mobile-days" aria-label="选择要查看的日期">{schedule.days.map((day) => <button key={day.date} type="button" aria-pressed={selectedDay === day.index} onClick={() => setSelectedDay(day.index)} className={`${selectedDay === day.index ? 'selected' : ''} ${day.date === calendar.today ? 'today' : ''}`} aria-label={`${day.month}月${day.day}日${day.name}${day.date === calendar.today ? '，今天' : ''}，${day.slots.length}个上课时段`}><span>{day.name.replace('周', '')}</span><strong>{day.day}</strong><i data-has-course={day.slots.length > 0} /></button>)}</div>
        <div className="week-schedule-grid">{schedule.days.map((day) => <section key={day.date} className={`week-day-column${day.date === calendar.today ? ' today' : ''}`} data-selected={selectedDay === day.index} aria-label={`${day.month}月${day.day}日${day.name}`}>
          <header className="week-day-heading"><div><span>{day.name}</span><small>{EN_DAYS[day.index]}</small></div><div><strong>{String(day.day).padStart(2, '0')}</strong>{day.date === calendar.today && <span className="week-today-badge">今天</span>}</div></header>
          <div className="week-day-classes">{day.slots.length ? day.slots.map((slot, index) => <article className={`week-class tone-${Number(slot.course_id || slot.id || index) % 4}`} key={slot.id ?? `${slot.course_name}-${slot.start_min}-${index}`}><div className="week-class-time"><time dateTime={`${day.date}T${minutesLabel(slot.start_min)}:00+08:00`}>{minutesLabel(slot.start_min)}</time><span>—</span><time>{minutesLabel(slot.end_min)}</time></div><h3>{displayCourse(slot.course_name) || '未命名课程'}</h3><p><UserRound size={11} /><span>{displayTeacher(slot.teacher)}</span></p><p><MapPin size={11} /><span>{displayLocation(slot.location)}</span></p></article>) : <div className="week-day-free"><Coffee size={19} strokeWidth={1.3} /><span>暂无课程</span><small>留一点时间给自己</small></div>}</div>
        </section>)}</div>
        <footer className="week-schedule-footer"><span><i />{schedule.slots.length ? '已按本周教学周次与单双周筛选' : '本周没有已安排的课程'}</span><Link to="/settings">管理课程连接 <ArrowUpRight size={13} /></Link></footer>
      </>}
  </section>;
}
