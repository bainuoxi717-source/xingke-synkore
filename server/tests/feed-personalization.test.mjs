import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fixture } from './learning-feed.fixture.mjs';
import { createFeedPackaging, cleanHeadline, similarHeadline, loadFeedCoverAssets } from '../src/services/feed-packaging.js';
import { commentPreference } from '../src/services/feed-personalization.js';
import { readingTick, readerBody } from '../../web/src/lib/feedSignals.js';

const send = (f, post, data) => f.service.signal(post.id, { id: randomUUID(), ...data });
const score = (f, value) => f.service.personalization.profile().values.find((s) => s.feature === 'interest' && s.value === value)?.score || 0;
function clockFixture(t) { let at = Date.parse('2026-11-02T02:30:00Z'); const f = fixture({ nowISO: () => new Date(at).toISOString() }); t.after(() => f.db.close()); return { ...f, advance: (ms) => { at += ms; } }; }

test('headline cleanup removes stacked labels and repeated headings without changing article sections', () => {
  assert.equal(cleanHeadline('标题：换个角度解读：那次离开真的只有一个理由吗｜那次离开真的只有一个理由吗｜写成一首诗'), '那次离开真的只有一个理由吗');
  assert.equal(similarHeadline('明明听着同一首歌，我们却想起不同的人', '明明听着同一首歌，我们却想起了不同的人'), true);
  assert.equal(readerBody('# 唯一的主标题\n\n## 小节标题\n正文', '唯一的主标题'), '## 小节标题\n正文');
  assert.equal(readerBody('唯一的主标题', '唯一的主标题'), '');
});

test('90 cards receive unique titles, 30% text covers and distinct image hashes; allocation remains stable', (t) => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE learning_feed_posts(id TEXT PRIMARY KEY)');
  const store = { q: (s, ...p) => db.prepare(s).all(...p), q1: (s, ...p) => db.prepare(s).get(...p), run: (s, ...p) => db.prepare(s).run(...p), nowISO: () => '2026-11-02T02:30:00Z' };
  const assets = Array.from({ length: 100 }, (_, i) => ({ id: `pexels-${i}`, sha256: `hash-${i}`, kind: 'music', src: `/assets/feed-covers/pexels-${i}.jpg`, sourcePage: `https://www.pexels.com/photo/${i}/`, provider: 'Pexels', licenseURL: 'https://www.pexels.com/license/' }));
  const packaging = createFeedPackaging({ ...store, assets }); packaging.initialize(); const decorated = [];
  for (let i = 0; i < 90; i++) { store.run('INSERT INTO learning_feed_posts VALUES(?)', `p-${i}`); decorated.push(packaging.decorate({ id: `p-${i}`, sourceHash: `src-${i}`, sceneKind: 'music', interest: '周杰伦', format: 'analysis', title: '同一个重复的旧标题', body: '原始正文' })); }
  assert.equal(new Set(decorated.map((p) => p.title)).size, 90);
  assert.equal(decorated.filter((p) => p.cover.type === 'text').length, 27);
  const photos = decorated.filter((p) => p.cover.type === 'photo'); assert.equal(new Set(photos.map((p) => p.cover.sha256)).size, 63);
  assert.ok(decorated.every((p) => p.body === '原始正文' && !p.title.includes('｜')));
  assert.deepEqual(packaging.decorate(decorated[0]), { ...decorated[0], originalTitle: decorated[0].title });
  const hash = photos[0].cover.sha256; packaging.removePost(photos[0].id); store.run('INSERT INTO learning_feed_posts VALUES(?)', 'p-fresh');
  assert.notEqual(packaging.decorate({ id: 'p-fresh', sourceHash: 'fresh', sceneKind: 'music', interest: '周杰伦', format: 'analysis' }).cover.sha256, hash);
});

test('downloaded photos have unique bytes and primary-source licensing; exhausted galleries use text instead of recycled pictures', (t) => {
  const assets = loadFeedCoverAssets(); assert.ok(assets.length >= 35); assert.equal(new Set(assets.map((a) => a.sha256)).size, assets.length);
  assert.ok(assets.every((a) => /^https:\/\/www.pexels.com\/photo\//.test(a.sourcePage) && a.licenseURL === 'https://www.pexels.com/license/'));
  const actual = fixture(); t.after(() => actual.db.close()); const originals = actual.service.list().posts;
  assert.equal(originals.filter((p) => p.cover.type === 'photo').length, 3);
  const photo = originals.find((p) => p.cover.type === 'photo');
  actual.run('UPDATE learning_feed_packaging SET cover_json=? WHERE post_id=?', JSON.stringify({ ...photo.cover, type: 'searched' }), photo.id);
  assert.equal(actual.service.get(photo.id).cover.type, 'photo');
  const f = fixture({ coverAssets: [] }); t.after(() => f.db.close()); const posts = f.service.list().posts;
  assert.ok(posts.every((p) => p.cover.type === 'text')); assert.equal(f.calls.length, 0);
});

test('clicks and cumulative active reading are idempotent, bounded by real elapsed time and resist repeated self-clicks', (t) => {
  const f = clockFixture(t), post = f.service.list().posts[0], visitId = randomUUID();
  const input = { id: randomUUID(), type: 'open', visitId }; f.service.signal(post.id, input); f.service.signal(post.id, input);
  assert.equal(f.service.personalization.profile().stats.opens, 1);
  f.advance(40000); const read = { id: randomUUID(), type: 'read', visitId, activeMs: 35000, scroll: .8 };
  f.service.signal(post.id, read); f.service.signal(post.id, read); send(f, post, { ...read, id: randomUUID(), activeMs: 1000 });
  assert.equal(f.service.personalization.profile().stats.activeSeconds, 35); assert.equal(f.service.personalization.profile().stats.effectiveReads, 1);
  send(f, post, { ...read, id: randomUUID(), activeMs: 99999999 }); assert.equal(f.service.personalization.profile().stats.activeSeconds, 42);
  send(f, post, { type: 'impression', sessionId: 'same-tab', visibleMs: 1100 }); send(f, post, { type: 'impression', sessionId: 'same-tab', visibleMs: 1100 });
  assert.equal(f.service.personalization.profile().stats.impressions, 1);
  assert.throws(() => send(f, post, { type: 'impression', sessionId: 'same-tab' }), /实际进入视野/);
  const before = score(f, post.interest);
  for (let i = 0; i < 12; i++) send(f, post, { type: 'open', visitId: randomUUID() });
  assert.ok(score(f, post.interest) <= before + .3); assert.equal(f.calls.length, 0);
});

test('foreground clock excludes hidden, unfocused and idle time and clamps delayed timers', () => {
  const state = { activeMs: 0, previous: 0, lastActivity: 0 };
  readingTick(state, 1000, true, true); assert.equal(state.activeMs, 1000);
  readingTick(state, 2000, false, true); readingTick(state, 3000, true, false); assert.equal(state.activeMs, 1000);
  readingTick(state, 46000, true, true); assert.equal(state.activeMs, 1000);
  state.lastActivity = 46000; readingTick(state, 47000, true, true); assert.equal(state.activeMs, 2000);
  state.lastActivity = 100000; readingTick(state, 100000, true, true); assert.equal(state.activeMs, 3500);
});

test('comment preferences distinguish topic taste from disagreement, confusion, quotations and hypotheses', () => {
  const post = { interest: '周杰伦' }, interests = ['周杰伦', '薛之谦', '诺兰的电影'];
  for (const text of ['我不同意这条观点，因为它没有考虑环境。', '我没听懂，请换个例子。', '有人说不喜欢周杰伦，我并不赞同。', '如果我不喜欢周杰伦，会怎样？', '“我不喜欢薛之谦”不是我的观点。', '我不是不喜欢周杰伦。']) assert.deepEqual(commentPreference(text, post, interests), [], text);
  const signals = commentPreference('我很喜欢周杰伦，但不太喜欢薛之谦，更想看歌词创作。', post, interests);
  assert.ok(signals.some((s) => s.value === '周杰伦' && s.direction === 1)); assert.ok(signals.some((s) => s.value === '薛之谦' && s.direction === -1)); assert.ok(signals.some((s) => s.value === 'lyrics' && s.direction === 1));
});

test('manual preference affects ranking and future writing choices; confusion remains a separate learning signal', (t) => {
  const f = clockFixture(t), post = f.service.list().posts[0];
  f.service.feedback(post.id, { status: 'confused' }); assert.equal(score(f, post.interest), 0);
  const original = f.service.list().posts.find((p) => p.id === post.id).recommendationScore;
  send(f, post, { type: 'preference', value: 'less' }); const less = f.service.list().posts.find((p) => p.id === post.id);
  assert.ok(less.recommendationScore < original); assert.equal(less.feedback, 'confused'); const one = score(f, post.interest);
  send(f, post, { type: 'preference', value: 'less' }); assert.equal(score(f, post.interest), one);
  send(f, post, { type: 'preference', value: 'more' }); assert.ok(score(f, post.interest) > 0);
  const prefs = f.service.preferences(), choices = Array.from({ length: 50 }, (_, i) => f.service.personalization.choice({ key: `new-source-${i}` }, prefs));
  assert.ok(choices.filter((p) => p.interest === post.interest).length > 30); assert.ok(choices.some((p) => p.choiceOrigin === 'explore'));
  assert.equal(f.calls.length, 0);
});

test('comments inform a frozen approved writing brief; packaging never erases generated text, sources or real discussion', async (t) => {
  const f = clockFixture(t); f.settings.deepseekKey = ''; const post = f.service.list().posts[0];
  await f.service.discussion.submit(post.id, { id: 'actual-comment', text: '我特别喜欢周杰伦，更想看歌词创作。', replyMode: 'none' });
  assert.ok(score(f, '周杰伦') > 1); f.settings.deepseekKey = 'fake-test-key'; const plan = f.service.plan(post.id);
  send(f, post, { type: 'preference', value: 'less' });
  const rewritten = await f.service.rewrite(post.id, { ...plan, approved: true });
  assert.equal(f.calls.length, 1); const input = JSON.parse(f.calls[0][2]);
  assert.deepEqual(input.readerPreferences, plan.context.creativeBrief); assert.deepEqual(input.recentTitles, plan.context.recentTitles);
  assert.ok(!JSON.stringify(input.readerPreferences).includes('我特别喜欢')); assert.ok(input.readerPreferences.preferredInterests.some((p) => p.value === '周杰伦'));
  const body = rewritten.post.body, sources = rewritten.post.sourceIds;
  f.service.list(); assert.equal(f.service.get(post.id).body, body); assert.deepEqual(f.service.get(post.id).sourceIds, sources);
  assert.equal(f.service.discussion.list(post.id).userCount, 1);
  f.run("UPDATE learning_feed_packaging SET revision='previous-version' WHERE post_id=?", post.id); f.service.list();
  assert.equal(f.service.get(post.id).body, body); assert.equal(f.service.discussion.list(post.id).userCount, 1);
});

test('pause, reset and deleting sources preserve user comments and bookmarks without resurrecting stale learning', async (t) => {
  const f = clockFixture(t); f.settings.deepseekKey = ''; const post = f.service.list().posts[0];
  f.service.feedback(post.id, { saved: true }); f.service.personalization.configure(false); f.advance(1000);
  send(f, post, { type: 'open', visitId: randomUUID() });
  await f.service.discussion.submit(post.id, { id: 'paused-comment', text: '我喜欢薛之谦这类题材。', replyMode: 'none' });
  f.advance(1000); f.service.personalization.configure(true); assert.equal(f.service.personalization.profile().stats.comments, 0); assert.equal(f.service.personalization.profile().stats.opens, 0);
  f.advance(1000); await f.service.discussion.submit(post.id, { id: 'active-comment', text: '我喜欢周杰伦这类题材。', replyMode: 'none' }); assert.equal(f.service.personalization.profile().stats.comments, 1);
  f.advance(1000); f.service.personalization.reset(); assert.equal(f.service.personalization.profile().stats.comments, 0);
  assert.equal(f.service.get(post.id).saved, true); assert.equal(f.service.discussion.list(post.id).userCount, 2);
  send(f, post, { type: 'preference', value: 'more' }); f.run('DELETE FROM qa_messages WHERE id=?', post.source.messageId); f.service.list();
  assert.equal(f.q1('SELECT COUNT(*) AS n FROM learning_feed_taste WHERE post_id=?', post.id).n, 0);
  assert.equal(f.q1('SELECT COUNT(*) AS n FROM learning_feed_packaging WHERE post_id=?', post.id).n, 0);
  assert.equal(f.calls.length, 0);
});
