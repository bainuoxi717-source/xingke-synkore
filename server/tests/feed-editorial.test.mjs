import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './learning-feed.fixture.mjs';
import { DEFAULT_INTERESTS, FORMATS, validateCoachReply, normalizePreferences } from '../src/services/feed-editorial.js';
import { parseBaiduBoard, normalizeSearchResults, dailyQueries, shanghaiDay } from '../src/services/feed-topics.js';

const comment = (changes = {}) => ({ id: 'user-comment-one', text: '如果只看一个结果，可能忽略当时不一样的条件。', replyMode: 'auto', ...changes });
const fakeBoard = async (url) => {
  const tab = new URL(url).searchParams.get('tab');
  const titles = tab === 'game' ? ['王者荣耀', '三角洲行动'] : tab === 'movie' ? ['诺兰的电影讨论'] : ['周杰伦新消息'];
  return `<!--s-data:${JSON.stringify({ data: { cards: [{ updateTime: '2026-11-02', content: titles.map((word, index) => ({ word, index, desc: '测试用公开榜单描述，不是真实新闻。', rawUrl: `https://www.baidu.com/s?wd=${encodeURIComponent(word)}` })) }] } })}-->`;
};
test('all supplied interests are editable and titles hide the underlying learning concept', (t) => {
  const f = fixture(); t.after(() => f.db.close());
  assert.deepEqual(f.service.preferences().interests, DEFAULT_INTERESTS);
  assert.ok(DEFAULT_INTERESTS.includes('吕彦良')); assert.ok(DEFAULT_INTERESTS.includes('三角洲'));
  const post = f.service.list().posts[0];
  assert.ok(!post.title.includes(post.topic)); assert.ok(!/课堂|知识点|函数|极限定义/.test(post.title));
  assert.ok(['text', 'photo'].includes(post.cover.type));
  if (post.cover.type === 'photo') assert.match(post.cover.src, /^\/assets\/feed-covers\/pexels-\d+\.jpg$/);
  assert.equal(post.seedComments.length, 3); assert.equal(new Set(post.seedComments.map((item) => item.stance)).size, 3);
  for (const format of FORMATS) {
    const next = f.service.presentation(post.id, { interest: '周杰伦', format: format.id }).post;
    assert.equal(next.format, format.id); assert.equal(next.interest, '周杰伦'); assert.ok(next.sourceIds.length);
    assert.ok(next.body.includes(post.source.body));
    if (['poem', 'lyrics'].includes(format.id)) assert.ok(next.body.includes('原创'));
  }
  assert.equal(f.calls.length, 0);
  assert.throws(() => normalizePreferences({ interests: [] }), /1到18/);
});
test('changing interests preserves saved feedback and does not invoke the provider', (t) => {
  const f = fixture(); t.after(() => f.db.close()); const post = f.service.list().posts[0];
  f.service.feedback(post.id, { saved: true, status: 'confused' });
  f.service.savePreferences({ interests: ['薛之谦', '诺兰的电影'], defaultFormat: 'rebuttal' });
  const next = f.service.list().posts.find((item) => item.id === post.id);
  assert.equal(next.saved, true); assert.equal(next.feedback, 'confused'); assert.equal(next.format, 'rebuttal');
  assert.ok(['薛之谦', '诺兰的电影'].includes(next.interest)); assert.equal(f.calls.length, 0);
});
test('discussion seeds have explicit agent identities and remain stable on repeat reads', (t) => {
  const f = fixture(); t.after(() => f.db.close()); const post = f.service.list().posts[0];
  const first = f.service.discussion.list(post.id), second = f.service.discussion.list(post.id);
  assert.equal(first.total, 3); assert.equal(first.userCount, 0);
  assert.deepEqual(first.comments.map((row) => row.id), second.comments.map((row) => row.id));
  assert.ok(first.comments.every((row) => row.kind === 'seed' && row.provider === 'preset'));
  assert.equal(f.calls.length, 0);
});
test('local comments, threaded replies and learning observations persist without claiming mastery', async (t) => {
  const f = fixture(); t.after(() => f.db.close()); f.settings.deepseekKey = '';
  const post = f.service.list().posts[0], seeds = f.service.discussion.list(post.id);
  const input = comment({ parentId: seeds.comments[0].id });
  const result = await f.service.discussion.submit(post.id, input);
  assert.equal(result.total, 5); assert.equal(result.userCount, 1);
  const user = result.comments.find((row) => row.id === input.id), coach = result.comments.find((row) => row.id === result.replyId);
  assert.equal(user.parentId, seeds.comments[0].id); assert.equal(coach.parentId, input.id);
  assert.equal(coach.provider, 'local-guidance'); assert.equal(coach.assessment.evidenceQuote, input.text);
  assert.ok(!coach.assessment.stage.includes('已掌握'));
  assert.equal((await f.service.discussion.submit(post.id, input)).total, 5);
  assert.equal(f.service.discussion.list(post.id).total, 5); assert.equal(f.calls.length, 0);
});
test('a paid coaching turn requires exact approval before saving or calling the model', async (t) => {
  const f = fixture(); t.after(() => f.db.close()); const post = f.service.list().posts[0];
  const input = comment(), unapproved = await f.service.discussion.submit(post.id, input);
  assert.equal(unapproved.needsConfirmation, true); assert.equal(f.calls.length, 0);
  assert.equal(f.q1("SELECT COUNT(*) AS n FROM learning_feed_comments WHERE kind='user'").n, 0);
  const plan = f.service.discussion.plan(post.id, input);
  await assert.rejects(() => f.service.discussion.submit(post.id, { ...input, text: '我已经修改了这条评论的内容和立场。', ...plan, approved: true }), /重新确认/);
  const result = await f.service.discussion.submit(post.id, { ...input, ...plan, approved: true });
  assert.equal(f.calls.length, 1); assert.equal(result.total, 5);
  assert.equal(result.comments.find((row) => row.id === result.replyId).assessment.evaluatedBy, 'model');
  await f.service.discussion.submit(post.id, { ...input, ...plan, approved: true });
  assert.equal(f.calls.length, 1);
});
test('simultaneous retries of one coaching turn cannot cause a second charge', async (t) => {
  const f = fixture(); t.after(() => f.db.close()); const post = f.service.list().posts[0], input = comment();
  let release; const held = new Promise((resolve) => { release = resolve; }); f.setDuringAI(() => held);
  const plan = f.service.discussion.plan(post.id, input), pending = f.service.discussion.submit(post.id, { ...input, ...plan, approved: true });
  const duplicate = await f.service.discussion.submit(post.id, { ...input, ...plan, approved: true });
  assert.equal(duplicate.processing, true); assert.equal(f.calls.length, 1); release();
  assert.equal((await pending).userCount, 1); assert.equal(f.calls.length, 1);
});
test('provider failure preserves the comment and is not retried silently', async (t) => {
  const f = fixture(); t.after(() => f.db.close()); const post = f.service.list().posts[0], input = comment();
  f.setDuringAI(() => { throw new Error('provider unavailable'); });
  const plan = f.service.discussion.plan(post.id, input), result = await f.service.discussion.submit(post.id, { ...input, ...plan, approved: true });
  assert.ok(result.agentError.includes('provider unavailable')); assert.equal(result.userCount, 1); assert.equal(result.total, 4);
  await f.service.discussion.submit(post.id, { ...input, ...plan, approved: true }); assert.equal(f.calls.length, 1);
});
test('thread parents, source versions and assessment quotes are validated', async (t) => {
  const f = fixture(); t.after(() => f.db.close()); const [a, b] = f.service.list().posts;
  const other = f.service.discussion.list(b.id).comments[0];
  assert.throws(() => f.service.discussion.plan(a.id, comment({ parentId: other.id })), /其他推文/);
  const current = f.service.discussion.list(a.id).contextHash; f.service.context(a.id, '新的笔记改变了当前文章所使用的材料。');
  await assert.rejects(() => f.service.discussion.submit(a.id, comment({ contextHash: current, replyMode: 'none' })), /推文内容已更新/);
  assert.throws(() => validateCoachReply({ text: '这是一条足够长的追问内容，请补一个依据。', sourceIds: ['a'], assessment: { stage: '已提出依据', observation: '观察', evidenceQuote: '没有说过的话', nextStep: '下一步' } }, ['a'], '我真正说过的话'), /真实回复/);
  assert.equal(f.calls.length, 0);
});
test('source changes during coaching retain user text but discard the stale generated reply', async (t) => {
  const f = fixture(); t.after(() => f.db.close()); const post = f.service.list().posts[0], input = comment();
  f.setDuringAI(() => f.service.context(post.id, '生成期间补充了另一条需要核对的学习材料。'));
  const result = await f.service.discussion.submit(post.id, { ...input, ...f.service.discussion.plan(post.id, input), approved: true });
  assert.ok(result.agentError.includes('发生变化'));
  assert.equal(result.comments.filter((row) => row.kind === 'agent').length, 0);
  assert.equal(result.comments.find((row) => row.kind === 'user').stale, true);
});
test('deleting original QA also removes derivative discussion records', async (t) => {
  const f = fixture(); t.after(() => f.db.close()); f.settings.deepseekKey = ''; const post = f.service.list().posts[0];
  await f.service.discussion.submit(post.id, comment());
  f.run('DELETE FROM qa_messages WHERE id=?', post.source.messageId); f.service.list();
  assert.equal(f.q1('SELECT COUNT(*) AS n FROM learning_feed_comments WHERE post_id=?', post.id).n, 0);
  assert.equal(f.q1('SELECT COUNT(*) AS n FROM learning_feed_discussion_turns WHERE post_id=?', post.id).n, 0);
});
test('rank observations and publication dates remain distinct; stale/future search results are excluded', () => {
  const observedAt = '2026-11-02T02:30:00Z';
  const html = `<!--s-data:${JSON.stringify({ data: { cards: [{ content: [{ word: '王者荣耀', index: 1, desc: '榜单记录', rawUrl: 'https://www.baidu.com/s?wd=game' }] }] } })}-->`;
  const board = parseBaiduBoard(html, { board: 'game', label: '百度游戏榜', interests: DEFAULT_INTERESTS, observedAt });
  assert.equal(board[0].publishedAt, null); assert.equal(board[0].observedAt, observedAt); assert.equal(board[0].rank, 2);
  const rows = normalizeSearchResults([
    { title: '周杰伦近期资讯', url: 'https://example.com/new', date: '2026-11-01T12:00:00Z' },
    { title: '旧消息', url: 'https://example.com/old', date: '2025-10-01T00:00:00Z' },
    { title: '未来消息', url: 'https://example.com/future', date: '2026-12-01T00:00:00Z' },
    { title: '时间未知', url: 'https://example.com/undated' }, { title: '无效链接', url: 'javascript:alert(1)' },
  ], { interests: DEFAULT_INTERESTS, observedAt, query: 'test' });
  assert.equal(rows.length, 2); assert.equal(rows.find((row) => row.title === '时间未知').kind, 'undated');
  assert.equal(dailyQueries(DEFAULT_INTERESTS, new Date(observedAt)).length, 3);
  assert.ok(dailyQueries(DEFAULT_INTERESTS).every((query) => query.length <= 128));
  assert.equal(shanghaiDay(new Date('2026-11-01T23:00:00Z')), '2026-11-02');
});
test('daily free boards create at most three source-linked drafts without model calls', async (t) => {
  const f = fixture({ readTopicBoard: fakeBoard }); t.after(() => f.db.close());
  assert.equal(f.service.list().total, 4);
  const result = await f.service.topics.refreshFree();
  assert.equal(result.running, false); assert.equal(result.draftIds.length, 3); assert.equal(f.calls.length, 0);
  assert.equal(f.service.list().total, 7);
  const draft = f.service.get(result.draftIds[0]); assert.ok(draft.topical.url.startsWith('https://')); assert.equal(draft.topical.kind, 'ranked');
  assert.ok(draft.source.sources.some((item) => item.kind === 'topic'));
  assert.equal((await f.service.topics.refreshFree()).draftIds.length, 0); assert.equal(f.service.list().total, 7);
});
test('paid search requires a one-use plan and duplicate approvals never call it again', async (t) => {
  const queries = [];
  const f = fixture({ searchTopics: async (key, query) => { queries.push(query); return [{ title: '周杰伦近期资讯', url: 'https://example.com/jay', date: '2026-11-01T12:00:00Z', summary: '测试摘要，来源与日期随结果保留。' }]; } }); t.after(() => f.db.close());
  assert.equal((await f.service.topics.searchNow()).needsConfirmation, true); assert.equal(queries.length, 0);
  const plan = f.service.topics.searchPlan(); assert.equal(plan.calls, 3); assert.equal(plan.maxSearchCostUSD, .00225);
  const result = await f.service.topics.searchNow({ ...plan, approved: true });
  assert.equal(queries.length, 3); assert.equal(result.running, false); assert.ok(result.topics.some((item) => item.kind === 'news'));
  assert.equal((await f.service.topics.searchNow({ ...plan, approved: true })).duplicate, true); assert.equal(queries.length, 3);
  assert.equal(f.calls.length, 0, 'Search must not silently generate paid articles');
});
test('changed interests or keys invalidate an approved search and quota errors stop the batch', async (t) => {
  let searches = 0;
  const f = fixture({ searchTopics: async () => { searches++; throw Object.assign(new Error('quota'), { status: 402 }); } }); t.after(() => f.db.close());
  const old = f.service.topics.searchPlan(); f.service.savePreferences({ interests: ['周杰伦'], defaultFormat: 'mix' });
  await assert.rejects(() => f.service.topics.searchNow({ ...old, approved: true }), /重新确认/); assert.equal(searches, 0);
  const fresh = f.service.topics.searchPlan(); f.settings.deepseekKey = 'another-fake-account';
  await assert.rejects(() => f.service.topics.searchNow({ ...fresh, approved: true }), /重新确认/); assert.equal(searches, 0);
  const final = f.service.topics.searchPlan(); const result = await f.service.topics.searchNow({ ...final, approved: true });
  assert.equal(searches, 1); assert.ok(result.lastRun.errors[0].includes('quota'));
  await f.service.topics.searchNow({ ...final, approved: true }); assert.equal(searches, 1);
});
test('writing confirmations bind the model account and cannot be reused for another charge', async (t) => {
  const f = fixture(); t.after(() => f.db.close()); const post = f.service.list().posts[0];
  const first = f.service.plan(post.id); f.settings.deepseekKey = 'different-fake-account';
  await assert.rejects(() => f.service.rewrite(post.id, { ...first, approved: true }), /账户|重新确认/); assert.equal(f.calls.length, 0);
  const approved = { ...f.service.plan(post.id), approved: true };
  await f.service.rewrite(post.id, approved); assert.equal(f.calls.length, 1);
  assert.equal((await f.service.rewrite(post.id, approved)).duplicate, true); assert.equal(f.calls.length, 1);
  const failedPlan = { ...f.service.plan(post.id), approved: true }; f.setDuringAI(() => { throw new Error('simulated network error'); });
  await assert.rejects(() => f.service.rewrite(post.id, failedPlan), /network error/); assert.equal(f.calls.length, 2);
  await assert.rejects(() => f.service.rewrite(post.id, failedPlan), /已经执行|重新确认/); assert.equal(f.calls.length, 2);
});
test('changing the search account during a batch stops all remaining paid queries', async (t) => {
  const keys = [];
  const f = fixture({ searchTopics: async (key) => { keys.push(key); f.settings.deepseekKey = 'new-unapproved-account'; return []; } }); t.after(() => f.db.close());
  const plan = f.service.topics.searchPlan(); assert.equal(plan.calls, 3);
  const result = await f.service.topics.searchNow({ ...plan, approved: true });
  assert.equal(keys.length, 1); assert.equal(result.lastRun.completedCalls, 1);
  assert.match(result.lastRun.errors[0], /账户已变化/);
  await f.service.topics.searchNow({ ...plan, approved: true }); assert.equal(keys.length, 1);
});
