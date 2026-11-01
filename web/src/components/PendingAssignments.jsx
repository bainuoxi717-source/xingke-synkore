import { useEffect, useState } from 'react';
import { ClipboardList, ArrowUpRight, ChevronDown, CheckCircle2, RotateCw } from 'lucide-react';
import { api } from '../api.js';
import { displayAssignmentTitle, displayCourse, redactShowcaseText } from '../utils/showcasePrivacy.js';

function dueDate(value) {
  if (!value) return null;
  let normalized = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) normalized += 'T23:59:59+08:00';
  else if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(normalized)) normalized = normalized.replace(' ', 'T') + '+08:00';
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
function deadline(value) {
  const date = dueDate(value);
  if (!date) return { text: '未设置截止时间', overdue: false };
  return {
    text: new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date) + ' 截止',
    overdue: date.getTime() < Date.now(),
  };
}

export default function PendingAssignments({ onAsk }) {
  const [items, setItems] = useState([]);
  const [state, setState] = useState('loading');
  const [expanded, setExpanded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setState('loading');
    api.get('/assignments').then((rows) => {
      if (!Array.isArray(rows)) throw new Error('Invalid assignments response');
      if (!active) return;
      const pending = rows.filter((item) => !['done', 'completed'].includes(item.status));
      pending.sort((a, b) => (dueDate(a.due_at)?.getTime() ?? Infinity) - (dueDate(b.due_at)?.getTime() ?? Infinity) || b.id - a.id);
      setItems(pending);
      setState('ready');
    }).catch(() => { if (active) setState('error'); });
    return () => { active = false; };
  }, [attempt]);
  const visible = expanded ? items : items.slice(0, 3);
  return <section className="pending-assignments" aria-labelledby="assignments-title">
    <div className="learning-panel-heading"><div><ClipboardList size={17} /><h2 id="assignments-title">未完成的作业</h2>{state === 'ready' && <span className="pending-count">{items.length}</span>}</div><span className="learning-panel-label">先处理眼前的一件事</span></div>
    {state === 'loading' ? <div className="learning-empty" role="status">正在读取作业…</div> : state === 'error' ? <div className="learning-empty learning-error" role="alert"><span>作业暂时读取失败</span><button onClick={() => setAttempt((n) => n + 1)}><RotateCw size={13} /> 重试</button></div> : !items.length ? <div className="learning-empty"><CheckCircle2 size={19} /><div>暂无未完成作业<small>当前本地记录中没有待完成的作业。</small></div></div> : <div className="assignment-list">
      {visible.map((item) => {
        const due = deadline(item.due_at);
        const title = displayAssignmentTitle(item.title || '未命名作业');
        return <button type="button" key={item.id} className="assignment-row" onClick={() => onAsk?.({ ...item, title, course_name: displayCourse(item.course_name), description: redactShowcaseText(item.description) })} aria-label={`讨论作业：${title}`}>
          <span className="assignment-status-dot" />
          <span className="assignment-main"><strong>{title}</strong><small>{displayCourse(item.course_name) || '未关联课程'}{item.status === 'doing' ? ' · 进行中' : ''}</small></span>
          <span className={`assignment-due ${due.overdue ? 'overdue' : ''}`}>{due.overdue && <b>已逾期</b>}{due.text}</span><ArrowUpRight size={16} />
        </button>;
      })}
    </div>}
    {items.length > 3 && <button className="assignments-expand" onClick={() => setExpanded(!expanded)}>{expanded ? '收起' : `查看全部 ${items.length} 项作业`}<ChevronDown size={14} style={{ transform: expanded ? 'rotate(180deg)' : undefined }} /></button>}
  </section>;
}
