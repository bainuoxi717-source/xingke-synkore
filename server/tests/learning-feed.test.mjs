import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSourceArticle, markedContext, retrieveSourceChunks, chunkDocument, feedPriority, validateEditedArticle, isLearningAnswer } from '../src/services/learning-feed-core.js';
import { fixture } from './learning-feed.fixture.mjs';

test('time windows retain only the marked context and keyword retrieval stays within provided pages', () => {
  const segments = [{ startMs: 0, endMs: 10, text: '开场' }, { startMs: 80000, endMs: 90000, text: '重点' }, { startMs: 200000, endMs: 201000, text: '其他' }];
  assert.deepEqual(markedContext(segments, 100000).map((item) => item.text), ['重点']);
  const chunks = chunkDocument([{ page: 7, text: '极限的定义要求关注趋近过程。'.repeat(120) }, { page: 9, text: '传播理论研究人际关系。' }]);
  assert.ok(chunks.length > 2); assert.ok(chunks.every((chunk) => chunk.text.length <= 700));
  assert.equal(retrieveSourceChunks(chunks, '极限的定义')[0].page, 7);
  assert.equal(retrieveSourceChunks(chunks, '完全没有这个词XYZ').length, 0);
});
test('source-based articles retain original knowledge; a timestamp alone stays pending', () => {
  const original = '函数在这个点没有定义，也可能存在极限。';
  const ready = buildSourceArticle({ origin: 'qa', question: '极限存在和函数定义有什么区别？', body: original, sources: [{ id: 'a' }] });
  assert.equal(ready.pending, false); assert.ok(ready.body.includes(original)); assert.deepEqual(ready.sourceIds, ['a']);
  const pending = buildSourceArticle({ origin: 'unclear', title: '微积分基础', body: '', sources: [] });
  assert.equal(pending.pending, true); assert.ok(pending.body.includes('回放字幕'));
  assert.equal(feedPriority({ origin: 'unclear' }, 'confused') - feedPriority({ origin: 'unclear' }, null), 4);
});
test('generated articles and misconception questions must cite actual supplied sources', () => {
  const value = { title: '先把极限的两个问题分开', body: '有效讲解。'.repeat(30), sourceIds: ['a'] };
  assert.equal(validateEditedArticle(value, ['a']).sourceIds[0], 'a');
  assert.throws(() => validateEditedArticle({ ...value, sourceIds: ['fake'] }, ['a']), /原始材料/);
  assert.throws(() => validateEditedArticle({ ...value, myth: { statement: '某个断言', answer: true, explanation: '说明', sourceIds: [] } }, ['a']), /来源/);
});
test('administrative questions and unsupported short answers do not masquerade as knowledge posts', () => {
  const answer = '极限关心趋近过程中函数值的变化，函数在该点没有定义，仍然可以存在极限。';
  assert.equal(isLearningAnswer('函数没有定义也可以存在极限吗？', answer), true);
  assert.equal(isLearningAnswer('你的口头禅是什么？', answer), false);
  assert.equal(isLearningAnswer('作业要交到哪个邮箱？', answer), false);
  assert.equal(isLearningAnswer('这个概念是什么意思？', '这个问题在课堂上没有专门讲过，所以无法确认，也不应当随意编造老师的讲课内容。'), false);
  assert.equal(isLearningAnswer('这个概念是什么意思？', answer, { coverage: 'none' }), false);
});
test('class marks align by the actual replay start and cannot mix courses or dates', (t) => {
  const f = fixture(); t.after(() => f.db.close());
  const { mark } = f.addMark(); const post = f.service.get(mark.postId);
  assert.equal(mark.offsetMs, 20 * 60000); assert.equal(post.source.replay.offsetMs, 18 * 60000);
  assert.equal(post.source.replay.courId, 501); assert.ok(post.body.includes('函数在这个点没有定义'));
  assert.ok(!post.body.includes('另一门课')); assert.ok(!post.body.includes('远离标记'));
  assert.equal(post.source.materials.length, 1); assert.equal(post.source.materials[0].id, 1);
  assert.equal(post.source.canvasUrl, 'https://canvas.example.edu/courses/101/files');
  assert.equal(post.source.sources.find((item) => item.kind === 'slide').page, 1);
  assert.equal(f.addMark().mark.id, mark.id); assert.equal(f.service.marks('2026-11-02:1').marks.length, 1);
  assert.throws(() => f.addMark({ id: 'wrong-day', date: '2026-11-03' }), /排课范围/);
  assert.throws(() => f.addMark({ id: 'wrong-week', date: '2026-11-09' }), /排课范围/);
  assert.throws(() => f.addMark({ id: 'outside', at: Date.parse('2026-11-02T09:59:59+08:00') }), /这节课之内/);
  assert.throws(() => f.addMark({ id: 'invalid-date', date: '2026-02-31' }), /真实课程/);
  assert.throws(() => f.addMark({ kind: 'important' }), /编号/);
});
test('pending timestamps become source-linked posts when subtitles arrive; feedback survives synchronization', (t) => {
  const f = fixture(); t.after(() => f.db.close());
  f.run('UPDATE lectures SET transcript_json=? WHERE cour_id=501', '[]');
  const { mark } = f.addMark(); assert.equal(f.service.get(mark.postId).pending, true);
  f.service.feedback(mark.postId, { status: 'confused', saved: true });
  f.run('UPDATE lectures SET transcript_json=? WHERE cour_id=501', JSON.stringify([{ start: 1070000, end: 1100000, text: '刚同步的课程字幕解释了函数极限。' }]));
  const post = f.service.list({ filter: 'unclear' }).posts[0];
  assert.equal(post.id, mark.postId); assert.equal(post.pending, false); assert.equal(post.saved, true); assert.equal(post.feedback, 'confused');
  assert.ok(post.body.includes('刚同步的课程字幕')); assert.equal(f.calls.length, 0);
});
test('manual context is retained once, with a source citation, across later refreshes', (t) => {
  const f = fixture(); t.after(() => f.db.close());
  const { mark } = f.addMark({ at: Date.parse('2026-11-02T10:03:00+08:00') });
  f.run('UPDATE lectures SET transcript_json=? WHERE cour_id=501', '[]');
  f.service.list();
  const note = '课堂上我对极限与定义之间的区别存在疑问。';
  f.service.context(mark.postId, note); f.service.list();
  const post = f.service.get(mark.postId);
  assert.equal(post.pending, false); assert.equal(post.source.sources.filter((item) => item.id === 'personal-note').length, 1);
  const sources = JSON.parse(f.q1('SELECT source_json FROM learning_feed_posts WHERE id=?', post.id).source_json);
  assert.ok(!sources.body.includes('补充笔记：')); assert.equal(sources.sources.find((item) => item.id === 'personal-note').text, note);
});
test('feedback has fixed weights, repeated clicks do not stack, bookmarks and pagination persist', (t) => {
  const f = fixture(); t.after(() => f.db.close());
  const initial = f.service.list({ limit: 2 }); assert.equal(initial.total, 4); assert.equal(initial.nextOffset, 2);
  const id = initial.posts[0].id, normal = initial.posts[0].priority;
  f.service.feedback(id, { status: 'confused', saved: true });
  const once = f.service.get(id).priority; f.service.feedback(id, { status: 'confused' });
  assert.ok(Math.abs(once - normal - 4) < .01); assert.ok(Math.abs(f.service.get(id).priority - once) < .01);
  f.service.feedback(id, { status: 'mastered' });
  assert.ok(Math.abs(f.service.get(id).priority - normal + 6) < .01);
  assert.equal(f.service.list({ filter: 'saved' }).posts[0].id, id);
  assert.equal(f.service.list({ offset: 2, limit: 2 }).posts.length, 2); assert.equal(f.calls.length, 0);
});
test('deleting the original QA removes its generated copy from the feed', (t) => {
  const f = fixture(); t.after(() => f.db.close());
  const post = f.service.list().posts[0]; f.service.feedback(post.id, { saved: true });
  f.run('DELETE FROM qa_messages WHERE id=?', post.source.messageId);
  assert.equal(f.service.list().total, 3); assert.throws(() => f.service.get(post.id), /不存在/);
});
test('AI rewrite requires approval for the exact source/model/recipe and preserves feedback', async (t) => {
  const f = fixture(); t.after(() => f.db.close());
  const post = f.service.list().posts[0];
  assert.equal((await f.service.rewrite(post.id)).needsConfirmation, true); assert.equal(f.calls.length, 0);
  const plan = f.service.plan(post.id);
  await assert.rejects(() => f.service.rewrite(post.id, { ...plan, approved: true, model: 'changed' }), /重新核对/);
  f.service.context(post.id, '新补充的课堂信息改变了素材内容。');
  await assert.rejects(() => f.service.rewrite(post.id, { ...plan, approved: true }), /重新核对/); assert.equal(f.calls.length, 0);
  f.service.feedback(post.id, { status: 'mastered', saved: true });
  const next = await f.service.rewrite(post.id, { ...f.service.plan(post.id), approved: true });
  assert.equal(f.calls.length, 1); assert.equal(next.post.mode, 'ai-edit'); assert.equal(next.post.saved, true); assert.equal(next.post.feedback, 'mastered');
  f.service.list(); assert.equal(f.service.get(post.id).mode, 'ai-edit');
});
test('source changes while a model request is in flight cannot replace the current article', async (t) => {
  const f = fixture(); t.after(() => f.db.close());
  const post = f.service.list().posts[0];
  f.setDuringAI(() => f.service.context(post.id, '生成期间又补充了一条新的学习材料。'));
  await assert.rejects(() => f.service.rewrite(post.id, { ...f.service.plan(post.id), approved: true }), /生成期间/);
  assert.equal(f.service.get(post.id).mode, 'source-edit'); assert.equal(f.calls.length, 1);
});
test('changes to course file availability preserve an existing rewrite; removed subtitles cannot remain as current evidence', async (t) => {
  const f = fixture(); t.after(() => f.db.close());
  const { mark } = f.addMark();
  await f.service.rewrite(mark.postId, { ...f.service.plan(mark.postId), approved: true });
  f.run('UPDATE materials SET downloaded=1 WHERE id=1'); f.service.list();
  assert.equal(f.service.get(mark.postId).mode, 'ai-edit');
  assert.equal(f.service.get(mark.postId).source.materials[0].url, '/api/materials/1/file');
  f.run('UPDATE lectures SET transcript_json=? WHERE cour_id=501', '[]'); f.service.list();
  const post = f.service.get(mark.postId);
  assert.equal(post.pending, true); assert.equal(post.source.body, '');
  assert.equal(post.source.sources.filter((item) => item.kind === 'lecture').length, 0);
});
