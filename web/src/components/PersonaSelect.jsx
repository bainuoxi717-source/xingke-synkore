import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { displayTeacher } from '../utils/showcasePrivacy.js';
export default function PersonaSelect({ value = '', onChange, onCustom, disabled = false }) {
  const [people, setPeople] = useState([]);
  const [error, setError] = useState(false);
  const location = useLocation(), navigate = useNavigate();
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/personas', { signal: controller.signal }).then((response) => { if (!response.ok) throw new Error(); return response.json(); }).then((result) => setPeople(result.personas || [])).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, []);
  const select = (event) => {
    if (event.target.value !== '__custom__') { onChange(event.target.value); return; }
    if (onCustom) { onCustom(); return; }
    const returnTo = location.pathname === '/' ? '/' + location.search : location.pathname + location.search;
    navigate(`/personas/custom?${new URLSearchParams({ returnTo })}`);
  };
  return <label className="persona-select"><Sparkles size={14} /><span>讲解方式</span><select value={value} onChange={select} disabled={disabled} aria-label="选择讲解人物">
    <option value="">学习助手</option>
    {['teacher', 'skill'].map((kind) => <optgroup key={kind} label={kind === 'teacher' ? '已蒸馏的老师' : '人物 Skill'}>{people.filter((person) => person.kind === kind && person.ready).map((person) => <option key={person.id} value={person.id}>{kind === 'teacher' ? displayTeacher(person.name) : person.name}</option>)}</optgroup>)}
    {people.some((person) => person.kind === 'custom' && person.ready) && <optgroup label="我的人物">{people.filter((person) => person.kind === 'custom' && person.ready).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</optgroup>}
    <option value="__custom__">自定义</option>
    {value && !people.some((person) => person.id === value) && <option value={value}>正在读取所选人物…</option>}
  </select>{error && <small>人物库暂不可用</small>}</label>;
}
