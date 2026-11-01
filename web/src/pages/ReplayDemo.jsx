import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, RotateCcw, ChevronLeft, ChevronRight, MessageCircle, Star, HelpCircle,
  BookOpen, Lightbulb, Link2, Quote, PlugZap, Unplug, ExternalLink, Check, AlertCircle } from 'lucide-react';
import { MascotCharacter } from '../components/LearningMascot.jsx';
import '../replay-demo.css';

const PUBLIC_DEMO = import.meta.env.VITE_PUBLIC_DEMO === '1';
const SERVICE = PUBLIC_DEMO ? '/demo-replay' : 'http://127.0.0.1:8771';
const TYPES = {
  answer: { label: '回答提问', Icon: MessageCircle }, comment: { label: '课堂评论', Icon: Quote },
  keypoint: { label: '标注重点', Icon: Star }, question: { label: '提出问题', Icon: HelpCircle },
  material: { label: '引申材料', Icon: BookOpen }, term: { label: '解释术语', Icon: Lightbulb },
  history: { label: '关联旧知', Icon: Link2 },
};
const mmss = value => `${Math.floor(Math.max(0, value) / 60).toString().padStart(2, '0')}:${Math.floor(Math.max(0, value) % 60).toString().padStart(2, '0')}`;
const activeCue = (cues, position) => [...cues].reverse().find(cue => cue.at <= position) || cues[0];
async function request(path, body) {
  const response = await fetch(SERVICE + path, { ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || data.error || '本机陪学连接暂时不可用');
  return data;
}

export default function ReplayDemo() {
  const [demo, setDemo] = useState(null), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [position, setPosition] = useState(0), [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(1);
  const [board, setBoard] = useState({ connected: false, ports: [] }), [port, setPort] = useState('COM3'), [connecting, setConnecting] = useState(false);
  const [tab, setTab] = useState('transcript'), [marks, setMarks] = useState([]), [choices, setChoices] = useState({});
  const video = useRef(null), subtitles = useRef(null), currentSubtitle = useRef(null);
  const client = useRef(null), sequence = useRef(Date.now() % 2147483647), lastSent = useRef(0), mounted = useRef(true);
  if (!client.current) {
    client.current = sessionStorage.getItem('synkore-replay-client') || crypto.randomUUID();
    sessionStorage.setItem('synkore-replay-client', client.current);
  }
  useEffect(() => {
    mounted.current = true;
    Promise.all([request('/demo'), request('/marks')]).then(([data, saved]) => {
      if (mounted.current) { setDemo(data); setMarks(saved.marks || []); setError(''); }
    }).catch(() => { if (mounted.current) setError('请先运行“启动五分钟陪学.cmd”，再刷新本页。'); });
    return () => { mounted.current = false; };
  }, []);
  const refreshBoard = useCallback(async () => {
    try { const data = await request('/board?client_id=' + client.current); if (mounted.current) setBoard(data); }
    catch { if (mounted.current) setBoard(old => ({ ...old, connected: false, error: '本机陪学连接已断开' })); }
  }, []);
  useEffect(() => { refreshBoard(); const timer = setInterval(refreshBoard, 2000); return () => clearInterval(timer); }, [refreshBoard]);
  const sync = useCallback((force = false) => {
    const element = video.current;
    if (!element || !board.connected || !board.owned) return;
    const now = performance.now();
    if (!force && now - lastSent.current < 700) return;
    lastSent.current = now;
    request('/position', { client_id: client.current, sequence: ++sequence.current,
      position: Math.min(300, Math.max(0, element.currentTime || 0)), playing: !element.paused && !element.ended })
      .catch(error => { if (mounted.current) setNotice(error.message); });
  }, [board.connected, board.owned]);
  useEffect(() => {
    if (!board.connected || !board.owned) return;
    sync(true); const timer = setInterval(() => sync(), 1500);
    return () => clearInterval(timer);
  }, [board.connected, board.owned, sync]);
  const cue = demo ? activeCue(demo.cues, position) : null;
  const spoken = demo?.transcript.find(segment => segment.start <= position && position < segment.end);
  useEffect(() => {
    if (!currentSubtitle.current || !subtitles.current || tab !== 'transcript') return;
    const container = subtitles.current, item = currentSubtitle.current;
    container.scrollTop = Math.max(0, item.offsetTop - container.offsetTop - 32);
  }, [spoken?.id, tab]);
  const seek = useCallback(value => {
    if (!video.current) return;
    video.current.currentTime = Math.max(0, Math.min(300, value));
    setPosition(video.current.currentTime); setNotice('');
  }, []);
  const toggle = async () => {
    if (!video.current) return;
    if (!video.current.paused) video.current.pause();
    else {
      if (video.current.ended) seek(0);
      try { await video.current.play(); setError(''); } catch { setError('回放尚未准备好，请稍后再试。'); }
    }
  };
  const attach = async () => {
    setConnecting(true); setNotice('');
    try {
      if (board.connected && board.owned) await request('/board/disconnect', { client_id: client.current, port });
      else await request('/board/connect', { client_id: client.current, port });
      await refreshBoard();
    } catch (error) { setNotice(error.message); }
    finally { setConnecting(false); }
  };
  const mark = async kind => {
    try {
      const saved = await request('/marks', { id: crypto.randomUUID(), kind, position: Math.min(300, video.current?.currentTime || 0) });
      setMarks(old => [...old, saved.mark]);
      setNotice(`已标记${kind === 'important' ? '重点' : '疑问'} · ${mmss(saved.mark.position)}`);
    } catch (error) { setNotice(error.message); }
  };
  if (!demo) return <div className="replay-page replay-loading"><p>{error || '正在准备这五分钟…'}</p>{error && <button onClick={() => location.reload()}>重新连接</button>}</div>;
  const { Icon, label } = TYPES[cue.type];
  const doneTypes = new Set(demo.cues.filter(c => c.at <= position).map(c => c.type));
  const ownConnection = board.connected && board.owned;
  return <div className="replay-page">
    <header className="replay-heading">
      <div><p className="replay-eyebrow"><span /> FIVE MINUTES, TOGETHER</p>
        <h1>回到课堂，<em>一起听懂。</em></h1>
        <p className="replay-course">{demo.subject}<span>·</span>{demo.date}<span>·</span>{demo.source === 'authored-public-sample' ? '示例 00:00–05:00' : '原课 17:30–22:30'}</p>
      </div>
      <div className="replay-demo-badge"><i /> 预分析模式 <span>05:00</span></div>
    </header>
    <div className="replay-disclosure"><BookOpen size={15} /><span>{demo.source === 'authored-public-sample' ? '公开示例课 · 预分析卡片 · 13处讲解跟随播放' : '课程回放 · 课前预分析 · 13处讲解跟随回放'}</span><details><summary>模式说明</summary><p>{demo.disclosure}</p></details></div>
    {error && <p className="replay-alert" role="alert"><AlertCircle size={16} />{error}</p>}
    <div className="replay-grid">
      <div className="replay-main-column">
        <section className="replay-player-panel" aria-label="五分钟课程回放">
          <div className="replay-video-stage">
            {demo.mediaReady ? <video ref={video} src={PUBLIC_DEMO ? '/demo-assets/research-methods-5min.mp4' : SERVICE + '/media'} preload="metadata" playsInline
              onTimeUpdate={() => { setPosition(video.current?.currentTime || 0); sync(); }}
              onPlay={() => { setPlaying(true); sync(true); }} onPause={() => { setPlaying(false); sync(true); }}
              onSeeked={() => { setPosition(video.current?.currentTime || 0); sync(true); }}
              onEnded={() => { setPlaying(false); setPosition(300); sync(true); }}
              onError={() => setError('课程片段暂时不能播放，请检查本机陪学连接后刷新。')} />
              : <div className="replay-media-wait">回放素材尚未准备，请查看伴学演示的运行说明。</div>}
            {!playing && demo.mediaReady && <button className="replay-overlay-play" onClick={toggle} aria-label="播放五分钟回放"><Play size={26} fill="currentColor" /></button>}
            <span className="replay-video-label">CANVAS ARCHIVE <i /> {demo.subject}</span>
          </div>
          <div className="replay-controls">
            <button className="replay-play" onClick={toggle} disabled={!demo.mediaReady} aria-label={playing ? '暂停回放' : '播放回放'}>{playing ? <Pause size={17} /> : <Play size={17} />} {playing ? '暂停' : '一起听课'}</button>
            <button className="replay-icon" onClick={() => seek(0)} aria-label="从头播放"><RotateCcw size={16} /></button>
            <div className="replay-clock"><b data-testid="replay-clock">{mmss(position)}</b><span>/ 05:00</span></div>
            <label className="replay-speed"><span className="sr-only">播放速度</span><select aria-label="播放速度" value={speed} onChange={event => { const value = Number(event.target.value); setSpeed(value); if (video.current) video.current.playbackRate = value; }}>{[.75, 1, 1.5, 2].map(value => <option key={value} value={value}>{value}×</option>)}</select></label>
          </div>
          <div className="replay-progress-wrap"><input type="range" aria-label="回放进度" min="0" max="300" step=".1" value={position} onChange={event => seek(Number(event.target.value))} style={{ '--progress': `${position / 3}%` }} />
            <div className="replay-cue-dots">{demo.cues.map(c => <button key={c.id} style={{ left: `${c.at / 3}%` }} className={c.at <= position ? 'passed' : ''} aria-label={`跳到${mmss(c.at)} ${c.title}`} title={`${mmss(c.at)} ${c.title}`} onClick={() => seek(c.at)} />)}</div>
          </div>
          <div className="replay-mark-actions"><button onClick={() => mark('important')}><Star size={14} />这里是重点</button><button onClick={() => mark('unclear')}><HelpCircle size={14} />这里没听懂</button><span>原课 {mmss(demo.originalStartSeconds + position)}</span></div>
        </section>
        <section className="replay-context-panel">
          <div className="replay-tabs" role="tablist" aria-label="课堂资料">{[['transcript', '课堂字幕'], ['sources', '当前依据'], ['marks', `我的标记 ${marks.length || ''}`]].map(([id, title]) => <button key={id} id={`replay-tab-${id}`} role="tab" aria-selected={tab === id} aria-controls={`replay-panel-${id}`} onClick={() => setTab(id)}>{title}</button>)}</div>
          <div className="replay-context-body" id={`replay-panel-${tab}`} role="tabpanel" aria-labelledby={`replay-tab-${tab}`}>
            {tab === 'transcript' && <div className="replay-transcript" ref={subtitles}>{demo.transcript.map(segment => <button key={segment.id} ref={spoken?.id === segment.id ? currentSubtitle : null} className={spoken?.id === segment.id ? 'current' : ''} onClick={() => seek(segment.start)}><time>{mmss(segment.start)}</time><span>{segment.text}</span></button>)}</div>}
            {tab === 'sources' && <Sources sources={cue.sources} demo={demo} onSeek={seek} />}
            {tab === 'marks' && <div className="replay-marks">{marks.length ? [...marks].sort((a, b) => a.position - b.position).map(item => <button key={item.id} onClick={() => seek(item.position)}>{item.kind === 'important' ? <Star size={15} /> : <HelpCircle size={15} />}<span>{item.kind === 'important' ? '这里是重点' : '这里没听懂'}</span><time>{mmss(item.position)}</time><ChevronRight size={14} /></button>) : <p>看到重要内容或有疑问时，点播放器下方的标记。</p>}</div>}
          </div>
        </section>
      </div>
      <aside className="replay-companion-column">
        <section className={`replay-insight replay-kind-${cue.type}`} aria-live="polite" aria-atomic="true" data-testid="active-insight" data-cue={cue.id}>
          <div className="replay-insight-top"><span className="replay-kind"><Icon size={14} />{label}</span><time>{mmss(cue.at)}</time></div>
          <h2>{cue.title}</h2><p className="replay-insight-text">{cue.text}</p>
          {cue.quiz && <div className="replay-quiz">{cue.quiz.options.map((option, index) => <button key={option} className={choices[cue.id] === index ? 'chosen' : ''} onClick={() => setChoices(old => ({ ...old, [cue.id]: index }))}><span>{String.fromCharCode(65 + index)}</span>{option}</button>)}{choices[cue.id] !== undefined && <p className="replay-quiz-result">{cue.quiz.explanation}</p>}</div>}
          {cue.steps && <details className="replay-steps" key={cue.id}><summary>展开解释思路 <ChevronRight size={13} /></summary><ol>{cue.steps.map(step => <li key={step}>{step}</li>)}</ol></details>}
          <div className="replay-insight-foot"><button onClick={() => setTab('sources')}><Link2 size={13} />查看{cue.sources.length}处依据</button><span>预分析讲解</span></div>
        </section>
        <section className="replay-device-panel" aria-label="桌面开发板">
          <div className="replay-device-heading"><div><span className={`replay-led ${ownConnection ? 'on' : ''}`} /><h3>桌面小幽灵</h3></div><span>{ownConnection ? (board.lastCue === cue.id ? '已同步' : '正在同步…') : '屏幕预览'}</span></div>
          <div className="replay-device-preview"><div className="replay-device-top"><span>回放陪学</span><MascotCharacter className="replay-mini-ghost" /></div><img src={PUBLIC_DEMO ? `/demo-assets/cards/${cue.id}-${playing}.png` : `${SERVICE}/preview/${cue.id}.png?playing=${playing}`} alt={`开发板提示：${cue.shortText}`} width="256" height="160" /></div>
          {PUBLIC_DEMO ? <p className="replay-course">屏幕效果预览 · USB 连接在本地版使用</p> : <div className="replay-device-connect">{board.ports?.length > 1 && <select aria-label="选择开发板串口" value={port} onChange={event => setPort(event.target.value)}>{board.ports.map(item => <option key={item.port} value={item.port}>{item.port}</option>)}</select>}<button onClick={attach} disabled={connecting || (board.connected && !board.owned)}>{ownConnection ? <Unplug size={14} /> : <PlugZap size={14} />}{connecting ? '正在连接…' : ownConnection ? '断开屏幕' : board.connected ? '其他页面已连接' : '连接开发板'}</button></div>}
          {board.error && <p className="replay-device-error">{board.error}</p>}
        </section>
      </aside>
    </div>
    {notice && <p className="replay-notice" role="status"><Check size={14} />{notice}</p>}
    <section className="replay-moments" aria-label="五分钟演示导航"><div className="replay-moments-heading"><h2>这五分钟，会发生什么？</h2><span>{doneTypes.size} / 7 类陪学时刻</span></div>
      <div className="replay-capabilities">{Object.entries(TYPES).map(([type, item]) => <button key={type} className={doneTypes.has(type) ? 'visited' : ''} onClick={() => seek(demo.cues.find(c => c.type === type).at)}><item.Icon size={14} />{item.label}{doneTypes.has(type) && <Check size={11} />}</button>)}</div>
      <div className="replay-moment-list">{demo.cues.map((item, index) => { const KindIcon = TYPES[item.type].Icon; return <button key={item.id} className={cue.id === item.id ? 'active' : ''} aria-current={cue.id === item.id ? 'step' : undefined} onClick={() => seek(item.at)}><span className="replay-moment-number">{String(index + 1).padStart(2, '0')}</span><KindIcon size={14} /><span>{item.title}</span><time>{mmss(item.at)}</time><ChevronRight size={13} /></button>; })}</div>
    </section>
    <footer className="replay-footer"><span>{demo.source === 'authored-public-sample' ? '人工脚本示例，小幽灵陪你建立联系。' : '历史课堂提供依据，小幽灵陪你建立联系。'}</span>{demo.canvasUrl && <a href={demo.canvasUrl} target="_blank" rel="noreferrer">打开 Canvas 原课程 <ExternalLink size={12} /></a>}</footer>
  </div>;
}

function Sources({ sources, demo, onSeek }) {
  return <div className="replay-sources">{sources.map((source, index) => <article key={`${source.kind}-${index}`}><div><span>{source.kind === 'web' ? '拓展参考 · 预设入口' : source.kind === 'history' ? '历史课堂' : '本节课堂'}</span>{source.kind !== 'web' && <time>{source.date} · 原课{mmss(source.startMs / 1000)}</time>}</div>
    <h3>{source.title || source.subject}</h3><p>{source.text || source.summary}</p>
    {source.kind === 'web' ? <a href={source.url} target="_blank" rel="noreferrer">阅读原始资料 <ExternalLink size={12} /></a> : source.courId === demo.courId ? <button onClick={() => onSeek((source.startMs / 1000) - demo.originalStartSeconds)}>定位到回放 <ChevronRight size={12} /></button> : <small>旧课原文保留，关联说明不作为因果验证。</small>}
  </article>)}</div>;
}
