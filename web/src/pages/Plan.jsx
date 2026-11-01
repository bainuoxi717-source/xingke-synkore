import { useEffect, useState } from 'react';
import { RefreshCw, CheckCircle2, Circle } from 'lucide-react';
import { api } from '../api.js';
import { DAY_NAMES, fmtTime } from '../utils.js';

export default function Plan() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  const load = async () => {
    setBusy(true);
    try {
      const d = await api.get('/plan?days=7');
      setData(d);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => { load(); }, []);

  const toggle = async (day, item) => {
    const items = day.items.map((it) => (it.key === item.key ? { ...it, done: !it.done } : it));
    await api.put(`/plan/${day.date}`, { items: items.map(({ key, done }) => ({ key, done })) });
    setData({ ...data, plan: data.plan.map((d) => (d.date === day.date ? { ...d, items } : d)) });
  };

  const doneCount = data ? data.plan.reduce((s, d) => s + d.items.filter((i) => i.done).length, 0) : 0;
  const totalCount = data ? data.plan.reduce((s, d) => s + d.items.length, 0) : 0;

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-title">学习计划</div>
          <div className="page-sub">
            {data ? `第 ${data.week} 周 · 根据课表空闲时间和 DDL 自动安排` : '加载中…'}
          </div>
        </div>
        <button className="btn primary" onClick={load} disabled={busy}>
          <RefreshCw size={15} /> 重新生成
        </button>
      </div>

      {data && (
        <>
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-title">本周概览</div>
            <div className="item-meta">
              <span className="chip ok">已安排 {totalCount} 个学习时段</span>
              <span className="chip accent">已完成 {doneCount}</span>
              {data.unplaced.length > 0 && (
                <span className="chip warn">有 {data.unplaced.length} 项任务没排进计划</span>
              )}
            </div>
            {data.unplaced.length > 0 && (
              <div className="section-note">
                未安排任务：{data.unplaced.map((t) => `${t.course ? `【${t.course}】` : ''}${t.title}`).join('；')}
                <br />原因：空闲时间不足或截止日已过。可把已完成的任务勾掉释放时间后重新生成。
              </div>
            )}
          </div>

          <div className="plan-grid">
            {data.plan.map((day) => {
              const dd = new Date(day.date + 'T00:00:00');
              const isToday = day.date === new Date().toISOString().slice(0, 10);
              return (
                <div key={day.date} className={`card plan-day${isToday ? ' today' : ''}`}>
                  <div className="plan-day-head">
                    <b>{dd.getMonth() + 1}/{dd.getDate()}</b>
                    <span>{DAY_NAMES[day.dow - 1]}{isToday ? ' · 今天' : ''}</span>
                  </div>

                  {day.busy.length > 0 && (
                    <div className="plan-busy">
                      {day.busy.map((b, i) => (
                        <div key={i} className="plan-block busy" style={{ borderColor: b.color || 'var(--accent)', color: b.color || 'var(--accent)' }}>
                          {b.course} {fmtTime(b.s)}–{fmtTime(b.e)}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="plan-items">
                    {day.items.length === 0 ? (
                      <div className="plan-empty">今天没有安排学习任务</div>
                    ) : (
                      day.items.map((it) => (
                        <div key={it.key} className={`plan-item${it.done ? ' done' : ''}`} onClick={() => toggle(day, it)}>
                          {it.done ? <CheckCircle2 size={17} color="var(--ok)" /> : <Circle size={17} color="var(--text-2)" />}
                          <div className="item-main">
                            <div className="item-title">{it.task}</div>
                            <div className="item-meta">
                              <span>{fmtTime(it.start)}–{fmtTime(it.end)}</span>
                              {it.course && <span className="chip course" style={{ '--c': it.color }}>{it.course}</span>}
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
