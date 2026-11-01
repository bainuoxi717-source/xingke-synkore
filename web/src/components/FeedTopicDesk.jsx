import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, ChevronDown, Radio, Search, RefreshCw } from 'lucide-react';
import { feedRequest as request } from '../lib/learningFeedApi.js';
const formatDate = (value) => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
export default function FeedTopicDesk({ onOpenPost, onRefresh }) {
  const [data, setData] = useState(null), [open, setOpen] = useState(false), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const [all, setAll] = useState(false), [visible, setVisible] = useState(5);
  useEffect(() => {
    const controller = new AbortController();
    const read = () => request('/topics', undefined, controller.signal).then(setData).catch((e) => { if (!controller.signal.aborted) setError(e.message); });
    read(); const timer = setInterval(() => { if (document.visibilityState === 'visible') read(); }, 30000);
    return () => { controller.abort(); clearInterval(timer); };
  }, []);
  const act = async (name, callback) => { if (busy) return; setBusy(name); setError(''); try { await callback(); } catch (e) { setError(e.message); } finally { setBusy(''); } };
  const refresh = () => act('free', async () => { setData(await request('/topics/refresh', {})); setOpen(true); onRefresh(); });
  const search = () => act('search', async () => {
    const plan = await request('/topics/search-plan');
    if (!plan.configured) { setError('本机尚未配置 DeepSeek API Key，可先使用免费热榜检索。'); setOpen(true); return; }
    setData(await request('/topics/search', { approved: true, planId: plan.planId, requestHash: plan.requestHash, version: plan.version })); setOpen(true); onRefresh();
  });
  const use = (topic) => act(topic.id, async () => { if (topic.draftPostId) { onOpenPost(topic.draftPostId); return; } const result = await request(`/topics/${topic.id}/use`, { postId: topic.suggestedPostId }); onRefresh(); onOpenPost(result.postId); });
  const relevant = data?.topics?.filter((item) => item.interestMatches?.length) || [];
  const rows = all ? data?.topics || [] : relevant.length ? relevant : (data?.topics || []).filter((item) => /电影|游戏/.test(item.sourceName));
  return <aside className="feed-topic-desk" aria-label="每日选题Agent">
    <div className="feed-topic-summary"><button type="button" className="feed-topic-toggle" aria-expanded={open} onClick={() => setOpen(!open)}><Radio size={15} /><strong>每日选题 Agent</strong><span>{data?.lastRun ? `${formatDate(data.lastRun.at)} 更新` : '等待首次检索'}</span><ChevronDown size={14} /></button><button type="button" disabled={!!busy} onClick={refresh}><RefreshCw size={13} className={busy === 'free' ? 'feed-spin' : ''} />{busy === 'free' ? '正在检索' : '免费热榜'}</button><button type="button" disabled={!!busy} onClick={search}><Search size={13} />{busy === 'search' ? '搜索中' : 'DeepSeek 联网搜'}</button></div>
    {open && <div className="feed-topic-content"><p>北京时间 08:30 检索公开热榜，优先找你的兴趣；自动整理最多 3 篇本地稿。联网广搜与 AI 成篇分别确认调用。</p>{data?.lastRun?.errors?.length > 0 && <p className="feed-topic-source-error">部分来源暂未返回新结果：{data.lastRun.errors.join('；')}</p>}
      <div className="feed-topic-filter"><button type="button" aria-pressed={!all} onClick={() => { setAll(false); setVisible(5); }}>兴趣相关</button><button type="button" aria-pressed={all} onClick={() => { setAll(true); setVisible(5); }}>全部线索</button><span>热榜记录与新闻线索分开标注</span></div>
      {rows.length ? rows.slice(0, visible).map((topic) => <div className="feed-topic-item" key={topic.id}><div><span className="feed-topic-kind">{topic.kind === 'ranked' ? '热榜观察' : topic.kind === 'news' ? '近期资讯' : '日期待核对'} · {topic.sourceName}{topic.rank ? ` #${topic.rank}` : ''}</span><a href={topic.url} target="_blank" rel="noreferrer">{topic.title}<ArrowUpRight size={13} /></a><small>{topic.publishedAt ? `发布 ${formatDate(topic.publishedAt)}` : `采集 ${formatDate(topic.observedAt)}`}{topic.interestMatches?.length ? ` · ${topic.interestMatches.join(' / ')}` : ''}</small></div><button type="button" disabled={!!busy || !topic.suggestedPostId} onClick={() => use(topic)}>{busy === topic.id ? '正在整理' : '用这个聊一篇'}</button></div>) : <div className="feed-topics-empty">{data?.topics?.length ? '当前没有匹配的兴趣线索，换“全部线索”看看，或用 DeepSeek 扩大搜索。' : '还没有取得话题线索。先检索公开热榜，或连接 DeepSeek 搜索你的兴趣。'}</div>}
      {rows.length > visible && <button className="feed-topic-more" type="button" onClick={() => setVisible((n) => n + 10)}>再看一些线索</button>}
    </div>}
    {error && <p className="feed-reader-error" role="alert">{error}{/API Key/.test(error) && <Link to="/settings">打开设置</Link>}</p>}
  </aside>;
}
