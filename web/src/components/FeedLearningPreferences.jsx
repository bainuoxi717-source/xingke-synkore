import { useEffect, useState } from 'react';
import { feedRequest as request } from '../lib/learningFeedApi.js';
import { redactShowcaseText } from '../utils/showcasePrivacy.js';
export default function FeedLearningPreferences() {
  const [profile, setProfile] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { const controller = new AbortController(); request('/learning-profile', undefined, controller.signal).then((r) => setProfile(r.profile)).catch(() => {}); return () => controller.abort(); }, []);
  const update = async (reset = false) => { const previous = profile; setBusy(true); setError(''); if (!reset) setProfile({ ...profile, enabled: !profile.enabled }); try { const result = await request(reset ? '/learning-profile/reset' : '/learning-profile', reset ? {} : { enabled: !previous.enabled }); setProfile(result.profile); window.dispatchEvent(new CustomEvent('synkore:feed-changed')); } catch (e) { setProfile(previous); setError(e.message); } finally { setBusy(false); } };
  if (!profile) return null;
  const positive = profile.values.filter((s) => s.feature === 'interest' && s.score > .5).sort((a, b) => b.score - a.score).slice(0, 4);
  const negative = profile.values.filter((s) => s.feature === 'interest' && s.score < -.5).slice(0, 4);
  return <section className="feed-learning-options" aria-label="推荐偏好学习"><div><h4>推荐，慢慢认识你。</h4><label><input type="checkbox" checked={profile.enabled} onChange={() => update()} disabled={busy} />根据阅读与互动调整推荐</label></div>
    <p>{profile.stats.effectiveReads} 次有效阅读 · {profile.stats.comments} 条评论 · {profile.confidence}</p>
    {(positive.length > 0 || negative.length > 0) && <div className="feed-affinity-tags">{positive.map((s) => <span key={s.value}>更常关注 · {s.value}</span>)}{negative.map((s) => <span key={s.value}>减少推荐 · {s.value}</span>)}</div>}
    <small>只计算前台有效阅读。观点不同不会直接算作不喜欢，仍不懂也不代表不喜欢。</small>
    {profile.evidence.length > 0 && <details><summary>查看明确表达过的偏好</summary>{profile.evidence.map((item, i) => <p key={i}>「{redactShowcaseText(item.quote)}」</p>)}</details>}
    <button type="button" disabled={busy} onClick={() => update(true)}>重置阅读偏好</button><small>保留固定兴趣、收藏与原始评论，清除自动学习及“多推 / 少推”反馈。数据保存在本机。</small>
    {error && <p role="alert">{error}</p>}
  </section>;
}
