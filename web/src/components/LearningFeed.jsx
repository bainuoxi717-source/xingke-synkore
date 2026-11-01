import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowUpRight, Bookmark, Check, ChevronDown, HelpCircle, LoaderCircle, Play, RefreshCw, Sparkles, Star, X, BookOpen, MessageCircle, SlidersHorizontal, ThumbsDown, ThumbsUp } from 'lucide-react';
import Markdown from './Markdown.jsx';
import FeedDiscussion from './FeedDiscussion.jsx';
import FeedTopicDesk from './FeedTopicDesk.jsx';
import FeedLearningPreferences from './FeedLearningPreferences.jsx';
import { useCardSignals, useReaderSignals, sendFeedSignal, readerBody } from '../lib/feedSignals.js';
import { feedRequest as request } from '../lib/learningFeedApi.js';
import { displayCourse, displayTeacher, redactShowcaseText } from '../utils/showcasePrivacy.js';
import { formatRecordingTime, wallTime } from '../utils/listeningTimeline.js';
import '../voicebox-feed.css';

const tabs = [['recommend', '为你推荐'], ['unclear', '再想想'], ['important', '重点回看'], ['qa', '聊过的'], ['saved', '收藏']];
const originNames = { qa: '问答灵感', important: '课堂重点', unclear: '课堂疑问' };
const safeLink = (url) => typeof url === 'string' && (/^https?:\/\//i.test(url) || /^\/api\//.test(url)) ? url : '';
const clean = (post, text) => redactShowcaseText(text, [post?.source?.teacher]);
const dayLabel = (value) => { const date = new Date(value); return Number.isFinite(+date) ? date.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric' }) : ''; };
const coverOf = (post) => /^\/assets\/feed-covers\/pexels-\d+\.jpg$/.test(post.cover?.src || '') ? post.cover.src : '';

function FeedCard({ post, onOpen, onSave, onPreference, saving }) {
  const cardRef = useRef(null);
  const [imageFailed, setImageFailed] = useState(false), textCover = post.cover?.type === 'text' || !coverOf(post) || imageFailed;
  useCardSignals(post.id, cardRef);
  useLayoutEffect(() => {
    const element = cardRef.current;
    const resize = () => {
      const grid = getComputedStyle(element.parentElement);
      const gap = parseFloat(grid.rowGap) || 0, row = parseFloat(grid.gridAutoRows) || 4;
      element.style.gridRowEnd = `span ${Math.max(1, Math.ceil((element.getBoundingClientRect().height + gap) / (row + gap)))}`;
    };
    resize();
    const observer = new ResizeObserver(resize); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <article ref={cardRef} data-post-id={post.id} data-cover-type={textCover ? 'text' : 'photo'} className={`feed-card${post.pending ? ' is-pending' : ''}`}>
    <button type="button" className={`feed-card-cover${textCover ? ` is-type-cover ${post.cover?.style === 'ink' ? 'is-ink' : ''}` : ''}`} onClick={() => onOpen(post)} aria-label={`阅读：${clean(post, post.title)}`}>
      {!textCover && <span className="feed-card-photo"><img src={coverOf(post)} alt={post.cover?.alt || '情境摄影配图'} loading="lazy" decoding="async" onError={() => setImageFailed(true)} /><span className="feed-photo-label">{post.topical ? post.topical.kind === 'ranked' ? '热榜观察' : '近期线索' : post.interest}</span><span className="feed-photo-credit">情境摄影</span></span>}
      <span className="feed-cover-top"><span>{post.pending ? 'TO BE CONTINUED' : post.category}</span><ArrowUpRight size={15} /></span>
      <strong>{clean(post, post.title)}</strong>
      {textCover && <span className="feed-type-signature">{post.interest}<span>SYNKORE</span></span>}
    </button>
    <div className="feed-card-caption"><button type="button" className="feed-card-summary" onClick={() => onOpen(post)}>{clean(post, post.dek)}</button>
      <div className="feed-card-foot"><span>醒课编辑部</span><button type="button" className="feed-card-comment-count" onClick={() => onOpen(post)} aria-label={`打开${post.discussionCount || 0}条讨论`}><MessageCircle size={14} />{post.discussionCount || 0}</button><button type="button" aria-label="少推这类内容" aria-pressed={post.personalPreference === 'less'} disabled={saving} onClick={() => onPreference(post, post.personalPreference === 'less' ? 'neutral' : 'less')}><ThumbsDown size={14} fill={post.personalPreference === 'less' ? 'currentColor' : 'none'} /></button><button type="button" className={post.saved ? 'is-saved' : ''} aria-label={post.saved ? '取消收藏推文' : '收藏推文'} aria-pressed={post.saved} disabled={saving} onClick={() => onSave(post)}><Bookmark size={15} fill={post.saved ? 'currentColor' : 'none'} /></button></div>
      {post.personalPreference === 'less' && <p className="feed-card-reason">已减少这类推荐 · 再点取消</p>}
      {post.recommendationReason?.startsWith('结合') && <p className="feed-card-reason">{post.recommendationReason}</p>}
      {post.feedback && <p className="feed-card-reason">{post.feedback === 'mastered' ? <><Check size={10} />已掌握 · 少一点推荐</> : <><HelpCircle size={10} />再换个角度想想</>}</p>}
    </div>
  </article>;
}

function PostReader({ post, onClose, onUpdate }) {
  const dialogRef = useRef(null), videoRef = useRef(null);
  useReaderSignals(post, dialogRef);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [note, setNote] = useState('');
  const [playback, setPlayback] = useState(null), [stream, setStream] = useState(0), [guess, setGuess] = useState(null);
  const [preferences, setPreferences] = useState(null), [interest, setInterest] = useState(post.interest || ''), [format, setFormat] = useState(post.format || 'analysis');
  const [writers, setWriters] = useState([]), [writerId, setWriterId] = useState('auto');
  const source = post.source || {};
  useEffect(() => { const controller = new AbortController(); request('/preferences', undefined, controller.signal).then((result) => setPreferences(result.preferences)).catch(() => {}); return () => controller.abort(); }, []);
  useEffect(() => { const controller = new AbortController(); request('/writers', undefined, controller.signal).then((result) => setWriters(result.writers)).catch(() => {}); return () => controller.abort(); }, []);
  useEffect(() => { setInterest(post.interest || ''); setFormat(post.format || 'analysis'); }, [post.interest, post.format]);
  useEffect(() => {
    const previous = document.activeElement;
    dialogRef.current?.querySelector('.feed-reader-close')?.focus();
    const handleKey = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab') return;
      const focusable = [...(dialogRef.current?.querySelectorAll('button:not(:disabled),a[href],textarea,select,summary,video[controls]') || [])].filter((item) => item.getClientRects().length);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', handleKey); document.body.style.overflow = previousOverflow; previous?.focus?.(); };
  }, [onClose]);
  const act = async (name, task) => {
    if (busy) return;
    setBusy(name); setError('');
    try { await task(); } catch (e) { setError(e.message); } finally { setBusy(''); }
  };
  const feedback = (status) => act('feedback', async () => onUpdate((await request(`/posts/${post.id}/feedback`, { status: post.feedback === status ? null : status })).post));
  const save = () => act('save', async () => onUpdate((await request(`/posts/${post.id}/feedback`, { saved: !post.saved })).post));
  const readReplay = () => act('replay', async () => {
    const result = await request(`/posts/${post.id}/replay`);
    result.streams = (result.streams || []).filter((item) => safeLink(item.url));
    if (!result.streams.length) throw new Error('这节课暂时没有可播放的回放');
    setPlayback(result); setStream(0);
  });
  const rewrite = () => act('rewrite', async () => {
    const { plan } = await request(`/posts/${post.id}/write-plan?writer=${encodeURIComponent(writerId)}`);
    if (!plan.configured) throw new Error('请先在设置中连接写作模型，再使用精编。当前文章可以直接阅读。');
    if (!plan.canGenerate) throw new Error('先等待回放字幕，或补充一句课堂笔记。');
    if (plan.sourceHash !== post.sourceHash) throw new Error('推文资料已更新，请重新打开正文再确认成篇。');
    onUpdate((await request(`/posts/${post.id}/rewrite`, { approved: true, planId: plan.planId, approvalHash: plan.approvalHash, model: plan.model, sourceHash: plan.sourceHash, recipeVersion: plan.recipeVersion })).post);
  });
  const remember = () => act('context', async () => { onUpdate((await request(`/posts/${post.id}/context`, { text: note })).post); setNote(''); });
  const reframe = () => act('presentation', async () => onUpdate((await request(`/posts/${post.id}/presentation`, { interest, format })).post));
  const taste = (value) => act('taste', async () => onUpdate((await sendFeedSignal(post.id, { type: 'preference', value: post.personalPreference === value ? 'neutral' : value })).post));
  return createPortal(<div className="feed-reader-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="feed-reader" role="dialog" aria-modal="true" aria-labelledby="feed-reader-title">
      <div className="feed-reader-toolbar"><span>SYNKORE / THE OTHER SIDE<span> / {dayLabel(source.wallTime || post.createdAt)}</span></span><button type="button" className="feed-reader-close" onClick={onClose} aria-label="关闭推文"><X size={20} /></button></div>
      <div className="feed-reader-spread">
      <header className={`feed-reader-heading${post.cover?.type === 'text' || !coverOf(post) ? ' is-type-heading' : ''}`}>
        {post.cover?.type === 'photo' && coverOf(post) && <><div className="feed-reader-photo"><img src={coverOf(post)} alt={post.cover.alt || '情境摄影配图'} /><span>情境摄影</span></div><div className="feed-reader-photo-source"><a href={safeLink(post.cover.sourcePage)} target="_blank" rel="noreferrer">摄影来源 · {post.cover.creator || post.cover.provider}<ArrowUpRight size={12} /></a><small>{post.cover.caption} · <a href={safeLink(post.cover.licenseURL)} target="_blank" rel="noreferrer">{post.cover.license}</a></small></div></>}
        <div className="feed-reader-covercopy"><span>{post.pending ? 'TO BE CONTINUED' : `${post.interest} / ${post.category}`}</span><h2 id="feed-reader-title">{clean(post, post.title)}</h2><p>{clean(post, post.dek)}</p><button type="button" className="feed-jump-comments" onClick={() => document.getElementById('feed-discussion-title')?.scrollIntoView({ block: 'start' })}><MessageCircle size={15} />看大家怎么说 · {post.discussionCount || 0}</button></div></header>
      <div className="feed-reader-content">
        <div className="feed-source-line"><img src="/assets/learning-mascot/mascot-smile.png" alt="" /><div><strong>醒课编辑部</strong><span>{post.mode === 'ai-edit' ? 'AI 成篇 · 有依据的不同看法' : '情境策划 · 观点预设'}</span></div><button type="button" className={`feed-save${post.saved ? ' is-saved' : ''}`} onClick={save} disabled={!!busy} aria-label={post.saved ? '取消收藏推文' : '收藏推文'} aria-pressed={post.saved}><Bookmark size={17} fill={post.saved ? 'currentColor' : 'none'} /></button></div>
        {post.topical && <div className="feed-topic-reference"><span>{post.topical.kind === 'ranked' ? '热榜观察' : '资讯线索'} / {post.topical.sourceName}</span><a href={safeLink(post.topical.url)} target="_blank" rel="noreferrer">{post.topical.title}<ArrowUpRight size={12} /></a><small>{post.topical.publishedAt ? `发布时间 ${dayLabel(post.topical.publishedAt)}` : `采集时间 ${dayLabel(post.topical.observedAt)}`}{post.topical.rank ? ` · 榜单第 ${post.topical.rank} 位` : ''}</small></div>}
        {!post.pending && preferences && <div className="feed-presentation-controls"><label>从哪里聊<select aria-label="选择推文兴趣" value={interest} onChange={(event) => setInterest(event.target.value)} disabled={!!busy}>{preferences.interests.map((item) => <option key={item}>{item}</option>)}</select></label><label>怎么写<select aria-label="选择推文写法" value={format} onChange={(event) => setFormat(event.target.value)} disabled={!!busy}>{preferences.formats.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><button type="button" disabled={!!busy || (interest === post.interest && format === post.format)} onClick={reframe}>换个切口</button></div>}
        <div className="feed-article-body"><Markdown text={clean(post, readerBody(post.body, post.title, post.originalTitle))} /></div>
        {!post.pending && post.replies?.length > 0 && <div className="feed-followups"><span className="feed-small-label">再想深一层</span>{post.replies.map((reply, index) => <details key={index}><summary>{clean(post, reply.heading)}<ChevronDown size={14} /></summary><Markdown text={clean(post, reply.body)} /></details>)}</div>}
        {post.myth && <div className="feed-myth"><span className="feed-small-label">这个说法，对吗？</span><p>{clean(post, post.myth.statement)}</p><div>{[[true, '对'], [false, '不对']].map(([value, label]) => <button type="button" key={label} aria-pressed={guess === value} onClick={() => setGuess(value)}>{label}</button>)}</div>{guess !== null && <p className="feed-myth-answer">{guess === post.myth.answer ? '判断正确。' : '再想一步。'}{clean(post, post.myth.explanation)}</p>}</div>}
        {post.pending && <div className="feed-context"><label htmlFor="feed-personal-note">还记得当时讲了什么？补充一句，先整理起来。</label><textarea id="feed-personal-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={12000} rows={3} placeholder="例如：老师讲到某个概念，我对这个例子有疑问……" /><button type="button" disabled={!!busy || note.trim().length < 5} onClick={remember}>{busy === 'context' ? '正在整理…' : '用这段笔记整理'}</button></div>}
        <div className="feed-original-links">{source.sessionId && <Link to={`/qa?sessionId=${source.sessionId}`}><BookOpen size={14} />回到原始问答<ArrowUpRight size={12} /></Link>}{source.replay && <button type="button" onClick={readReplay} disabled={!!busy}><Play size={14} />{busy === 'replay' ? '正在连接…' : `回放定位 ${formatRecordingTime(source.replay.offsetMs)}`}</button>}{safeLink(source.canvasUrl) && <a href={safeLink(source.canvasUrl)} target="_blank" rel="noreferrer">这门课的 Canvas<ArrowUpRight size={12} /></a>}</div>
        {playback && <div className="feed-replay">{playback.streams.length > 1 && <select aria-label="选择回放画面" value={stream} onChange={(event) => setStream(Number(event.target.value))}>{playback.streams.map((item, index) => <option key={index} value={index}>{clean(post, item.message || `画面 ${index + 1}`)}</option>)}</select>}<video key={playback.streams[stream].url} ref={videoRef} controls playsInline preload="metadata" src={safeLink(playback.streams[stream].url)} onLoadedMetadata={() => { const video = videoRef.current; if (video) video.currentTime = Math.min(playback.offsetMs / 1000, Number.isFinite(video.duration) ? Math.max(0, video.duration - .1) : Infinity); }} onError={() => setError('回放播放失败，可在课程平台打开该课次。')} /><small>已定位到你标记的讲课时间</small></div>}
        {(source.sources?.length > 0 || source.materials?.length > 0) && <details className="feed-source-details"><summary>对照原材料<span>{source.sources?.length || 0} 条来源<ChevronDown size={14} /></span></summary><div className="feed-learning-origin"><strong>{displayCourse(source.courseName || '本篇所用材料')}</strong><span>{source.teacher ? `${displayTeacher(source.teacher)} · ` : ''}{originNames[post.origin]}{source.wallTime ? ` · ${wallTime(source.wallTime)} 标记 · 课程 ${formatRecordingTime(source.classOffsetMs)}` : ''}</span></div><div>{(source.sources || []).map((item) => <div className="feed-source-excerpt" key={item.id}><strong>{clean(post, item.label)}</strong>{item.kind === 'slide' && Number.isFinite(item.seekMs) && <small>PPT 切换于回放 {formatRecordingTime(item.seekMs)}{item.proximityMs > 90000 ? ' · 邻近页面，供对照' : ''}</small>}<p>{clean(post, item.text)}</p>{safeLink(item.url) && <a href={safeLink(item.url)} target="_blank" rel="noreferrer">{item.kind === 'topic' ? '打开这条话题来源' : '查看这一页 PPT'}<ArrowUpRight size={12} /></a>}</div>)}{source.materials?.length > 0 && <div className="feed-course-materials"><strong>这门课的资料</strong><small>以下是课程资料，不代表恰好对应这一分钟。</small>{source.materials.filter((item) => safeLink(item.url)).map((item) => <a key={item.id} href={safeLink(item.url)} target="_blank" rel="noreferrer">{clean(post, item.name)}<ArrowUpRight size={12} /></a>)}</div>}</div></details>}
        {error && <p className="feed-reader-error" role="alert">{error}{/设置/.test(error) && <Link to="/settings">打开设置<ArrowUpRight size={12} /></Link>}</p>}
        <div className="feed-taste-controls"><span>这种题材，想多看一些吗？</span><div><button type="button" disabled={!!busy} aria-pressed={post.personalPreference === 'more'} onClick={() => taste('more')}><ThumbsUp size={14} />多来点</button><button type="button" disabled={!!busy} aria-pressed={post.personalPreference === 'less'} onClick={() => taste('less')}><ThumbsDown size={14} />少推这类</button></div></div>
        <div className="feed-feedback-bar"><span>这一次，理解了吗？</span><div><button type="button" className={post.feedback === 'confused' ? 'selected confused' : ''} disabled={!!busy || post.pending} aria-pressed={post.feedback === 'confused'} onClick={() => feedback('confused')}><HelpCircle size={15} />仍不懂</button><button type="button" className={post.feedback === 'mastered' ? 'selected' : ''} disabled={!!busy || post.pending} aria-pressed={post.feedback === 'mastered'} onClick={() => feedback('mastered')}><Check size={15} />已掌握</button></div></div>
        {!post.pending && <div className="feed-writer-choice"><label>创作方式<select aria-label="选择创作方式" value={writerId} disabled={!!busy || !writers.length} onChange={(event) => setWriterId(event.target.value)}><option value="auto">自动搭配</option>{writers.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><small>{writerId === 'auto' ? '按内容与阅读反馈搭配，不固定比例。' : writers.find((item) => item.id === writerId)?.description}</small></div>}
        {!post.pending && <div className="feed-refine"><span>{post.mode === 'ai-edit' ? `AI 成篇 · ${post.writer?.label || '保留出处'}` : '本地情境稿 · 可继续成篇'}</span><button type="button" disabled={!!busy} onClick={rewrite}>{busy === 'rewrite' ? <LoaderCircle className="feed-spin" size={13} /> : <Sparkles size={13} />}{busy === 'rewrite' ? '正在成篇…' : 'AI 成篇＋观点评论'}</button></div>}
        {post.writer && post.mode === 'ai-edit' && <p className="feed-writer-source">写作方法：<a href={safeLink(post.writer.url)} target="_blank" rel="noreferrer">{post.writer.name}</a> · 醒课适配 · <a href={safeLink(post.writer.url + '/blob/main/LICENSE')} target="_blank" rel="noreferrer">{post.writer.license}</a></p>}
        {!post.pending && <FeedDiscussion post={post} onCountChange={(count) => { if (post.discussionCount !== count) onUpdate({ ...post, discussionCount: count }, false); }} />}
      </div>
      </div>
    </section>
  </div>, document.body);
}

function InterestPreferences({ preferences, onSave, onCancel }) {
  const [interests, setInterests] = useState(preferences.interests), [defaultFormat, setDefaultFormat] = useState(preferences.defaultFormat), [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const catalog = [...new Set([...preferences.catalog.map((item) => item.label), ...interests])];
  const toggle = (value) => setInterests((old) => old.includes(value) ? old.filter((item) => item !== value) : [...old, value]);
  const add = () => { const value = extra.trim(); if (value && value.length <= 30) { setInterests((old) => [...new Set([...old, value])]); setExtra(''); } };
  const save = async (event) => { event.preventDefault(); setBusy(true); setError(''); try { const result = await request('/preferences', { interests, defaultFormat }); onSave(result.preferences); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  return <form className="feed-preferences" onSubmit={save} aria-label="我的信息流兴趣">
    <div className="feed-preferences-head"><h3>从你在意的事，聊起。</h3><button type="button" onClick={onCancel} aria-label="关闭兴趣设置"><X size={17} /></button></div>
    <fieldset><legend>兴趣入口</legend><div className="feed-interest-options">{catalog.map((item, index) => <label key={item} className={interests.includes(item) ? 'selected' : ''}><input type="checkbox" checked={interests.includes(item)} onChange={() => toggle(item)} /><span>{item}</span></label>)}</div></fieldset>
    <div className="feed-preferences-custom"><label htmlFor="feed-extra-interest">也可以加一个</label><input id="feed-extra-interest" maxLength={30} value={extra} placeholder="歌手、电影、游戏或别的话题" onChange={(event) => setExtra(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add(); } }} /><button type="button" onClick={add} disabled={!extra.trim()}>添加</button></div>
    <FeedLearningPreferences />
    <div className="feed-preferences-bottom"><label>默认写法<select value={defaultFormat} onChange={(event) => setDefaultFormat(event.target.value)}><option value="mix">解读、辩驳、诗文和歌词，穿插着看</option>{preferences.formats.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><button type="submit" className="primary" disabled={busy || !interests.length}>{busy ? '正在整理…' : '保存兴趣'}</button></div>
    {error && <p className="feed-reader-error" role="alert">{error}</p>}
  </form>;
}

export default function LearningFeed() {
  const location = useLocation(), navigate = useNavigate();
  const [filter, setFilter] = useState('recommend'), [result, setResult] = useState({ posts: [], counts: {} });
  const [loading, setLoading] = useState(true), [more, setMore] = useState(false), [error, setError] = useState(''), [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState(null), [savingId, setSavingId] = useState('');
  const [preferences, setPreferences] = useState(null), [showPreferences, setShowPreferences] = useState(false);
  const filterRef = useRef(filter), loadController = useRef(null), moreController = useRef(null);
  filterRef.current = filter;
  useEffect(() => { const controller = new AbortController(); request('/preferences', undefined, controller.signal).then((value) => setPreferences(value.preferences)).catch(() => {}); return () => controller.abort(); }, []);
  useEffect(() => {
    const controller = new AbortController(); loadController.current = controller;
    moreController.current?.abort(); setMore(false); setLoading(true); setError('');
    request(`/?filter=${filter}&limit=24`, undefined, controller.signal).then((next) => { setResult(next); }).catch((e) => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filter, refresh]);
  useEffect(() => {
    const update = () => setRefresh((value) => value + 1);
    const timer = setInterval(() => { if (document.visibilityState === 'visible' && !moreController.current) update(); }, 60000);
    window.addEventListener('synkore:feed-changed', update);
    return () => { clearInterval(timer); window.removeEventListener('synkore:feed-changed', update); moreController.current?.abort(); };
  }, []);
  const postId = new URLSearchParams(location.search).get('post');
  useEffect(() => {
    if (!postId) { setSelected(null); return; }
    const controller = new AbortController();
    request(`/posts/${encodeURIComponent(postId)}`, undefined, controller.signal).then((value) => setSelected(value.post)).catch((e) => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [postId]);
  const open = (post) => { setSelected(post); const params = new URLSearchParams(location.search); params.set('post', post.id); navigate({ pathname: '/learning-feed', search: `?${params}` }, { replace: true }); };
  const close = useCallback(() => { setSelected(null); const params = new URLSearchParams(location.search); params.delete('post'); navigate({ pathname: '/learning-feed', search: params.size ? `?${params}` : '' }, { replace: true }); }, [location.search, navigate]);
  const updatePost = (post, shouldRefresh = true) => {
    setSelected((previous) => previous?.id === post.id ? post : previous);
    setResult((previous) => ({ ...previous, posts: previous.posts.map((item) => item.id === post.id ? post : item) }));
    if (shouldRefresh) setRefresh((value) => value + 1);
  };
  const save = async (post) => {
    if (savingId) return;
    setSavingId(post.id); setError('');
    try { updatePost((await request(`/posts/${post.id}/feedback`, { saved: !post.saved })).post); } catch (e) { setError(e.message); } finally { setSavingId(''); }
  };
  const prefer = async (post, value) => { if (savingId) return; setSavingId(post.id); try { updatePost((await sendFeedSignal(post.id, { type: 'preference', value })).post); } catch (e) { setError(e.message); } finally { setSavingId(''); } };
  const loadMore = async () => {
    if (more || loading || result.nextOffset == null) return;
    const controller = new AbortController(), currentFilter = filter;
    moreController.current = controller; setMore(true);
    try {
      const next = await request(`/?filter=${filter}&limit=24&offset=${result.nextOffset}`, undefined, controller.signal);
      if (currentFilter === filterRef.current) setResult((previous) => ({ ...next, posts: [...previous.posts, ...next.posts.filter((item) => !previous.posts.some((old) => old.id === item.id))] }));
    } catch (e) { if (!controller.signal.aborted) setError(e.message); } finally { if (moreController.current === controller) { moreController.current = null; setMore(false); } }
  };
  const openById = async (id) => { try { open((await request(`/posts/${encodeURIComponent(id)}`)).post); } catch (e) { setError(e.message); } };
  return <section id="learning-feed" className="learning-feed" aria-labelledby="learning-feed-title">
    <header className="feed-section-heading"><div><span className="feed-eyebrow">SYNKORE / THE OTHER SIDE</span><h2 id="learning-feed-title">别急着同意。</h2><p>听首歌，看场电影，打一局游戏。然后，说说你怎么想。</p></div><div className="feed-heading-actions"><span>OPINIONS, NOT ANSWERS.</span><div><button type="button" aria-label="设置我的兴趣" onClick={() => setShowPreferences(!showPreferences)} disabled={!preferences}><SlidersHorizontal size={16} /></button><button type="button" aria-label="刷新学习流" onClick={() => setRefresh((value) => value + 1)} disabled={loading}><RefreshCw size={16} className={loading ? 'feed-spin' : ''} /></button></div></div></header>
    {showPreferences && preferences && <InterestPreferences preferences={preferences} onCancel={() => setShowPreferences(false)} onSave={(value) => { setPreferences(value); setShowPreferences(false); setRefresh((n) => n + 1); }} />}
    <FeedTopicDesk onOpenPost={openById} onRefresh={() => setRefresh((value) => value + 1)} />
    <div className="feed-filters" role="group" aria-label="筛选学习流">{tabs.map(([id, label]) => <button type="button" key={id} className={filter === id ? 'active' : ''} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}{id === 'saved' && result.counts.saved > 0 && <small>{result.counts.saved}</small>}</button>)}</div>
    {result.counts.pending > 0 && <button type="button" className={`feed-pending-strip${filter === 'pending' ? ' active' : ''}`} onClick={() => setFilter(filter === 'pending' ? 'recommend' : 'pending')}><Star size={13} /><span>{result.counts.pending} 个课堂时间点，等回放就绪再接着看</span><ArrowUpRight size={13} /></button>}
    {error && <div className="feed-load-error" role="alert">{error}<button type="button" onClick={() => setRefresh((value) => value + 1)}>重试</button></div>}
    {loading && result.posts.length === 0 ? <div className="feed-loading"><LoaderCircle size={20} className="feed-spin" />正在整理你的学习片段…</div> : !error && result.posts.length === 0 ? <div className="feed-empty"><img src="/assets/learning-mascot/mascot-smile.png" alt="" /><h3>{filter === 'saved' ? '把想再看的，留在这里。' : filter === 'recommend' ? '你的下一次理解，从这里开始。' : '这一栏，等你来填满。'}</h3><p>{filter === 'saved' ? '在卡片上点一下收藏，复习时就能找到。' : '回到首页标记课堂时间点，或进入个性化助手聊一个问题。'}</p></div> : <div className="feed-masonry" aria-busy={loading}>{result.posts.map((post) => <FeedCard key={post.id} post={post} onOpen={open} onSave={save} onPreference={prefer} saving={savingId === post.id} />)}</div>}
    {result.nextOffset != null && <button type="button" className="feed-load-more" disabled={more || loading} onClick={loadMore}>{more ? <LoaderCircle size={14} className="feed-spin" /> : <ChevronDown size={14} />}{more ? '正在加载…' : '再看一些'}</button>}
    <footer className="feed-section-footer"><span>synkore·醒课</span><span>好看的不止封面。你的理由，也值得留下。</span></footer>
    {selected && <PostReader key={selected.id} post={selected} onClose={close} onUpdate={updatePost} />}
  </section>;
}
