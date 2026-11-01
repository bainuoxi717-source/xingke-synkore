import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HelpCircle, Star, ChevronDown, Clock3, RotateCw, ArrowUpRight } from 'lucide-react';
import { MascotCharacter } from './LearningMascot.jsx';
import { classTimelineLessons, chooseLesson, lessonProgress, lessonDurations, wallTime, formatRecordingTime, clamp, lessonSegments } from '../utils/listeningTimeline.js';
import { getShanghaiWeek } from '../utils/weekSchedule.js';
import { displayCourse } from '../utils/showcasePrivacy.js';
import { sendClassMark, syncPendingClassMarks, pendingClassMarks } from '../lib/classMarkers.js';
import '../listening-space.css';

export default function ListeningSpace({ motion = true }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null), [replays, setReplays] = useState([]);
  const [now, setNow] = useState(Date.now()), [selectedKey, setSelectedKey] = useState(null);
  const [cursor, setCursor] = useState(null), [marks, setMarks] = useState([]);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    const controller = new AbortController();
    const read = async (url) => { const response = await fetch(url, { signal: controller.signal }); if (!response.ok) throw new Error(); return response.json(); };
    Promise.all([read('/api/listening/schedule'), read('/api/learning-feed/timeline')]).then(([schedule, history]) => { setData(schedule); setReplays(history.replays || []); setError(''); })
      .catch(() => { if (!controller.signal.aborted) setError('课程时间暂时未连接，请稍后重新读取。'); });
    return () => controller.abort();
  }, [attempt]);
  const today = getShanghaiWeek(new Date(now)).today;
  const lessons = useMemo(() => {
    const scheduled = classTimelineLessons(data, new Date(now));
    const archived = replays.filter((replay) => !scheduled.some((lesson) => lesson.courseId === replay.courseId && lesson.date === replay.date && replay.startAt >= lesson.startAt - 900000 && replay.startAt < lesson.endAt))
      .map((replay) => {
        const startMinute = Number(wallTime(replay.startAt).slice(0, 2)) * 60 + Number(wallTime(replay.startAt).slice(3));
        const endMinute = startMinute + (replay.endAt - replay.startAt) / 60000;
        const segments = lessonSegments(startMinute, endMinute, data?.periods || []).map((part) => ({ ...part, startAt: replay.startAt + (part.start - startMinute) * 60000, endAt: replay.startAt + (part.end - startMinute) * 60000 }));
        return { ...replay, segments, breaksKnown: !segments.some((part) => part.inferred) };
      });
    return [...scheduled, ...archived].sort((a, b) => b.startAt - a.startAt);
  }, [data, replays, today]);
  const sorted = [...lessons].sort((a, b) => a.startAt - b.startAt);
  const active = sorted.find((item) => now >= item.startAt && now < item.endAt);
  const todayNext = sorted.find((item) => item.date === today && item.startAt > now);
  const latest = [...sorted].reverse().find((item) => item.endAt < now);
  const automatic = active || todayNext || latest || chooseLesson(sorted, now);
  const lesson = lessons.find((item) => item.key === selectedKey) || automatic;
  const durations = lessonDurations(lesson), progress = lessonProgress(lesson, now);
  const currentIsValid = lesson && now >= lesson.startAt && now <= lesson.endAt;
  const markAt = cursor != null && lesson ? lesson.startAt + cursor : currentIsValid ? now : null;
  const canMark = Number.isFinite(markAt) && !busy;
  const lessonKey = lesson?.key;
  const visibleLessonKey = useRef(lessonKey);
  visibleLessonKey.current = lessonKey;
  useEffect(() => { setCursor(null); setNotice(''); }, [lessonKey]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  const loadMarks = async () => {
    if (!lessonKey) { setMarks([]); return; }
    const response = await fetch(`/api/learning-feed/marks?lessonKey=${encodeURIComponent(lessonKey)}`);
    if (!response.ok) throw new Error('标记读取失败');
    const result = await response.json();
    const pending = pendingClassMarks().filter((item) => item.lessonKey === lessonKey).map((item) => ({ ...item, offsetMs: item.at - lesson.startAt, pending: true }));
    if (visibleLessonKey.current === lessonKey) setMarks([...(result.marks || []), ...pending.filter((item) => !(result.marks || []).some((saved) => saved.id === item.id))]);
  };
  useEffect(() => {
    let active = true;
    syncPendingClassMarks().then(() => { if (active) return loadMarks(); }).catch(() => { if (active) setNotice('本地标记还在，联网后我会继续同步。'); });
    const reconnect = () => syncPendingClassMarks().then(loadMarks).catch(() => {});
    window.addEventListener('online', reconnect);
    return () => { active = false; window.removeEventListener('online', reconnect); };
  }, [lessonKey]);
  const mark = async (kind) => {
    if (!canMark || !lesson) return;
    const at = Math.min(lesson.endAt, Math.max(lesson.startAt, Math.round(markAt)));
    const item = { id: crypto.randomUUID(), kind, at, slotId: lesson.slotId, courId: lesson.courId, date: lesson.date, lessonKey: lesson.key };
    setBusy(true); setError('');
    try {
      const saved = await sendClassMark(item); setMarks((old) => [...old.filter((mark) => mark.id !== saved.id), saved]);
      setNotice(`${kind === 'unclear' ? '已标记没听懂' : '已标记重点'} · 课程 ${formatRecordingTime(at - lesson.startAt)}`);
    } catch (e) {
      if (e.pending) {
        setMarks((old) => [...old.filter((mark) => mark.id !== item.id), { ...item, offsetMs: at - lesson.startAt, pending: true }]);
        setNotice('已暂存在本机，联网后自动同步。');
      } else setError(e.message || '标记未保存，请重新尝试。');
    } finally { setBusy(false); }
  };
  const ticks = useMemo(() => {
    if (!lesson) return [];
    const points = new Map([[lesson.startAt, '课程开始'], [lesson.endAt, '课程结束']]);
    for (const part of lesson.segments.filter((part) => part.kind === 'break')) {
      if (part.startAt > lesson.startAt) points.set(part.startAt, '课间开始');
      if (part.endAt < lesson.endAt) points.set(part.endAt, '课间结束');
    }
    return [...points].sort((a, b) => a[0] - b[0]).map(([at, label]) => ({ at, label, ratio: clamp((at - lesson.startAt) / (lesson.endAt - lesson.startAt)) }));
  }, [lesson]);
  const hints = progress.segment?.kind === 'break'
    ? ['课间歇一会儿，疑问也可以补记。', '重点先记下来，待会一起消化。']
    : progress.state === 'active'
      ? ['没听懂？点一下，我帮你记住。', '重点值得记，点“是重点”就好。']
      : ['点跑道选时间，疑问和重点都能记。', '没听懂也没关系，记下来一起想。'];
  const guide = error || notice || (cursor != null && lesson ? `选中 ${wallTime(markAt)} · 记下疑问或重点` : hints[Math.floor(now / 9000) % hints.length]);
  const mood = error ? 'concerned' : busy ? 'thinking' : notice ? notice.includes('没听懂') ? 'curious' : 'happy' : cursor != null ? 'curious' : progress.segment?.kind === 'break' ? 'rest' : 'eager';
  return <section id="listening-space" className={`class-timeline${motion ? '' : ' is-motion-paused'}`} aria-label="课程时间标记">
    {lesson ? <>
      <div className="class-timeline-course"><label><select disabled={busy} aria-label="选择标记课程" value={lesson.key} onChange={(event) => setSelectedKey(event.target.value)}>{lessons.map((item) => <option key={item.key} value={item.key}>{item.date === today ? '今天' : item.date.slice(5).replace('-', '/')} · {displayCourse(item.title)} · {wallTime(item.startAt)}—{wallTime(item.endAt)}</option>)}</select><ChevronDown size={13} /></label><span className={`class-live-badge ${progress.state}`}>{progress.state === 'active' ? progress.segment?.kind === 'break' ? '课间休息' : '课程进行中' : progress.state === 'upcoming' ? '即将开始' : '课后回看'}</span></div>
      <div className="class-timeline-meta"><span><Clock3 size={12} />{wallTime(lesson.startAt)} — {wallTime(lesson.endAt)}</span><span>共 {durations.total} 分钟</span>{lesson.breaksKnown ? <><span>上课 {durations.classes} 分钟</span><span>课间 {durations.breaks} 分钟</span></> : <span>课间未设定</span>}</div>
      <div className={`class-race${error ? ' has-error' : ''}`}>
        <div className={`class-runner-dialog${error ? ' has-error' : ''}${notice ? ' has-notice' : ''}`} style={{ '--runner-ratio': progress.ratio }}>
          <div className="class-runner-bubble" role={error ? 'alert' : notice ? 'status' : undefined} aria-label={notice || error ? undefined : '小幽灵的学习提醒'}>
            <span>{guide}</span>{error ? <button type="button" onClick={() => setAttempt((value) => value + 1)}><RotateCw size={10} />重新读取</button> : cursor != null && <button type="button" onClick={() => setCursor(null)}>回到此刻</button>}
          </div>
        </div>
        <div className="class-runway" role="progressbar" aria-label="课程时间进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.ratio * 100)}>
        <div className="class-runway-segments">{lesson.segments.map((part, index) => <span key={index} className={part.kind} style={{ width: `${(part.endAt - part.startAt) / (lesson.endAt - lesson.startAt) * 100}%` }} title={`${part.label} ${wallTime(part.startAt)}—${wallTime(part.endAt)}`} />)}</div>
        <div className="class-runway-progress" style={{ width: `${progress.ratio * 100}%` }} />
        {ticks.filter((point) => point.ratio > 0 && point.ratio < 1).map((point) => <span className="class-boundary-tick" key={point.at} style={{ left: `${point.ratio * 100}%` }} aria-hidden="true" />)}
        <div className={`class-runner ${mood}${progress.state === 'active' && progress.segment?.kind !== 'break' ? ' running' : ''}`} style={{ left: `${progress.ratio * 100}%` }} data-facing="finish" data-expression={mood} aria-hidden="true">
          <span className="class-runner-shadow" />
          <span className="class-runner-trail"><i /><i /><i /></span>
          <div className="class-runner-hop"><div className="class-runner-direction"><MascotCharacter className="class-runner-character" /></div></div>
        </div>
        {marks.map((item) => <span key={item.id} className={`class-runway-flag ${item.kind}${item.pending ? ' pending' : ''}`} style={{ left: `${clamp(item.offsetMs / (lesson.endAt - lesson.startAt)) * 100}%` }} title={`${item.kind === 'unclear' ? '没听懂' : '重点'} · 课程 ${formatRecordingTime(item.offsetMs)}`}>{item.kind === 'unclear' ? '?' : '★'}</span>)}
        {cursor != null && <span className="class-time-cursor" style={{ left: `${clamp(cursor / (lesson.endAt - lesson.startAt)) * 100}%` }} />}
        <input className="class-time-scrubber" aria-label="选择课程时间点" type="range" min="0" max={Math.floor((lesson.endAt - lesson.startAt) / 1000)} step="1" value={Math.floor((cursor ?? progress.ratio * (lesson.endAt - lesson.startAt)) / 1000)} onChange={(event) => setCursor(Number(event.target.value) * 1000)} onClick={(event) => setCursor(Number(event.currentTarget.value) * 1000)} onKeyDown={(event) => { if (event.key === 'Home') setCursor(0); if (event.key === 'End') setCursor(Math.floor((lesson.endAt - lesson.startAt) / 1000) * 1000); }} />
      </div>
      <div className="class-runway-times" aria-label="课程与课间时间节点">{ticks.map((point, index) => <span key={point.at} className={index === 0 ? 'start' : index === ticks.length - 1 ? 'finish' : 'break-time'} style={{ left: `${point.ratio * 100}%` }} title={point.label} aria-label={`${point.label} ${wallTime(point.at)}`}><time dateTime={new Date(point.at).toISOString()}>{wallTime(point.at)}</time></span>)}</div>
      <div className="class-mark-buttons"><button type="button" className="unclear" disabled={!canMark} onClick={() => mark('unclear')}><HelpCircle size={15} />没听懂</button><button type="button" className="important" disabled={!canMark} onClick={() => mark('important')}><Star size={15} />是重点</button></div>
      </div>
      {marks.length > 0 && <div className="class-saved-marks" aria-label="已保存的课程时间标记">{marks.map((item) => <button type="button" key={item.id} className={item.kind} onClick={() => item.postId ? navigate(`/learning-feed?post=${encodeURIComponent(item.postId)}`) : setCursor(item.offsetMs)}><span>{item.kind === 'unclear' ? '?' : '★'}</span>{formatRecordingTime(item.offsetMs)}{item.pending ? <small>待同步</small> : <ArrowUpRight size={11} />}</button>)}</div>}
    </> : <div className="class-timeline-empty">{data ? '还没有可关联的课程时间，连接课程后即可标记。' : '正在读取课程时间…'}</div>}
    {error && !lesson && <p className="class-mark-error" role="alert">{error}<button type="button" onClick={() => setAttempt((value) => value + 1)}><RotateCw size={12} />重新读取</button></p>}
  </section>;
}
