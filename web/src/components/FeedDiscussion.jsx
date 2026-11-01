import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CornerDownRight, MessageCircle, Send, X, RefreshCw } from 'lucide-react';
import { feedRequest as request } from '../lib/learningFeedApi.js';
import { redactShowcaseText } from '../utils/showcasePrivacy.js';

const storageKey = (id) => `voicebox:comment-draft:${id}`;
const freshDraft = () => ({ id: crypto.randomUUID(), text: '', parentId: null });
function readDraft(id) { try { const saved = JSON.parse(sessionStorage.getItem(storageKey(id)) || 'null'); return saved?.id && typeof saved.text === 'string' ? { ...saved, text: saved.text.slice(0, 2000) } : freshDraft(); } catch { return freshDraft(); } }
const stamp = (value) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

export default function FeedDiscussion({ post, onCountChange }) {
  const [data, setData] = useState({ comments: [], total: 0 }), [draft, setDraft] = useState(() => readDraft(post.id));
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(''), [message, setMessage] = useState(''), [visible, setVisible] = useState(40);
  const editorRef = useRef(null), countCallback = useRef(onCountChange), alive = useRef(true);
  countCallback.current = onCountChange;
  const clean = (text) => redactShowcaseText(text, [post.source?.teacher]);
  const apply = (result) => { if (!alive.current) return; setData(result); countCallback.current?.(result.total); };
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => request(`/posts/${post.id}/comments`, undefined, controller.signal).then(apply).catch((e) => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    refresh();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 15000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [post.id, post.body]);
  useEffect(() => { try { if (draft.text) sessionStorage.setItem(storageKey(post.id), JSON.stringify(draft)); else sessionStorage.removeItem(storageKey(post.id)); } catch {} }, [post.id, draft]);
  const updateDraft = (change) => setDraft((old) => ({ ...old, ...change, id: crypto.randomUUID() }));
  const replyTo = (comment) => { updateDraft({ parentId: comment.id }); editorRef.current?.focus(); };
  const target = data.comments.find((comment) => comment.id === draft.parentId) || (draft.parentId ? { name: '先前版本的评论' } : null);
  const submit = async (withAgent) => {
    if (busy || loading || draft.text.trim().length < 2) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const body = { ...draft, text: draft.text.trim(), replyMode: withAgent ? 'auto' : 'none', contextHash: data.contextHash };
      const alreadySent = data.comments.some((comment) => comment.id === draft.id);
      let approval = {};
      if (withAgent && !alreadySent) {
        const plan = await request(`/posts/${post.id}/comments/plan`, body);
        if (data.contextHash && plan.contextHash !== data.contextHash) throw new Error('推文内容已更新，请重新打开正文再回复，草稿会保留。');
        if (plan.calls) {
          approval = { approved: true, model: plan.model, requestHash: plan.requestHash, coachVersion: plan.coachVersion };
        }
      }
      const result = await request(`/posts/${post.id}/comments`, { ...body, ...approval });
      apply(result); setDraft(freshDraft());
      setVisible((n) => Math.max(n, result.comments.length));
      setMessage(result.agentError ? `评论已保存。${result.agentError}` : result.processing ? '评论已保存，智能体仍在接话。' : withAgent ? '已接话，继续把你的理由说具体。' : '评论已发布。');
      window.dispatchEvent(new CustomEvent('synkore:feed-changed'));
    } catch (e) { setError(e.message); } finally { if (alive.current) setBusy(false); }
  };
  const comments = data.comments.slice(0, visible), byParent = new Map();
  for (const comment of comments) { const key = comments.some((row) => row.id === comment.parentId) ? comment.parentId : null; if (!byParent.has(key)) byParent.set(key, []); byParent.get(key).push(comment); }
  const renderComment = (comment, depth = 0) => <article key={comment.id} className={`feed-comment ${comment.kind}${depth ? ' nested' : ''}`} aria-label={`${comment.kind === 'user' ? '我的评论' : '智能体评论'}：${comment.name}`}>
    <div className="feed-comment-author"><span className="feed-comment-avatar" aria-hidden="true">{comment.kind === 'user' ? '我' : comment.role === 'coach' ? '醒' : comment.role === 'challenger' ? '反' : comment.role === 'evidence' ? '证' : '换'}</span><div><strong>{comment.name}</strong><span>{comment.kind === 'user' ? '我的想法' : `智能体 · ${comment.provider === 'preset' ? '观点预设' : comment.provider === 'local-guidance' ? '本地引导' : 'AI生成'}`}{comment.stance ? ` / ${comment.stance}` : ''}</span></div><time dateTime={comment.createdAt}>{stamp(comment.createdAt)}</time></div>
    {comment.stale && <span className="feed-comment-stale">这条讨论基于之前的推文版本</span>}
    <p className="feed-comment-text">{clean(comment.text)}</p>
    {comment.assessment && <div className="feed-learning-observation"><span>根据这条回复的学习观察</span><strong>{clean(comment.assessment.stage)}</strong><p>{clean(comment.assessment.observation)}</p>{comment.assessment.evidenceQuote && <blockquote>“{clean(comment.assessment.evidenceQuote)}”</blockquote>}<p><b>再往前一步：</b>{clean(comment.assessment.nextStep)}</p></div>}
    <div className="feed-comment-actions"><button type="button" onClick={() => replyTo(comment)}><CornerDownRight size={13} />回复</button>{comment.sourceIds?.length > 0 && <button type="button" onClick={() => { const details = document.querySelector('.feed-reader .feed-source-details'); if (details) { details.open = true; details.scrollIntoView({ block: 'start', behavior: 'smooth' }); } }}>对照依据</button>}</div>
    {depth < 10 && (byParent.get(comment.id) || []).map((child) => renderComment(child, depth + 1))}
  </article>;
  return <section className="feed-discussion" aria-labelledby="feed-discussion-title">
    <div className="feed-discussion-title"><h3 id="feed-discussion-title">把话说开。</h3><span>{data.total} 条讨论 · {data.userCount || 0} 条来自你</span></div>
    <p className="feed-discussion-note">反方、证据派、换位派，都在这里。观点可以交锋，把理由留下。</p>
    {loading ? <p className="feed-comments-loading">正在打开讨论…</p> : <div className="feed-comment-list">{(byParent.get(null) || []).map((comment) => renderComment(comment))}</div>}
    {data.comments.length > visible && <button type="button" className="feed-comments-more" onClick={() => setVisible((n) => n + 40)}>继续看讨论</button>}
    <form className="feed-comment-form" onSubmit={(event) => { event.preventDefault(); submit(true); }}>
      {target && <div className="feed-reply-target"><span>回复 @{target.name}</span><button type="button" aria-label="取消回复目标" onClick={() => updateDraft({ parentId: null })}><X size={13} /></button></div>}
      <label htmlFor="feed-comment-editor">轮到你了</label>
      <textarea ref={editorRef} id="feed-comment-editor" value={draft.text} rows={3} maxLength={2000} onChange={(event) => updateDraft({ text: event.target.value })} placeholder="你站哪边？给一个理由，或者直接抛个反例。" disabled={busy} aria-describedby="feed-comment-mode" />
      <div className="feed-comment-mode" id="feed-comment-mode"><span><MessageCircle size={12} />{data.configured ? 'DeepSeek 接话与学习观察' : '本地追问 · 连接模型后可做语义评估'}</span><span>{draft.text.length}/2000</span></div>
      <div className="feed-comment-submit"><button type="button" disabled={busy || loading || draft.text.trim().length < 2} onClick={() => submit(false)}>仅发布</button><button type="submit" className="primary" disabled={busy || loading || draft.text.trim().length < 2}><Send size={13} />{busy ? '正在接话…' : data.configured ? '发布并让 AI 接话' : '发布并继续思考'}</button></div>
      {!data.configured && <Link className="feed-connect-link" to="/settings">连接 DeepSeek</Link>}
      {message && <p className="feed-comment-message" role="status">{message}</p>}
      {error && <p className="feed-reader-error" role="alert">{error}<button type="button" onClick={() => request(`/posts/${post.id}/comments`).then(apply).catch(() => {})}><RefreshCw size={12} />刷新讨论</button></p>}
    </form>
  </section>;
}
