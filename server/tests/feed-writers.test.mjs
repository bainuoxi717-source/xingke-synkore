import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from './learning-feed.fixture.mjs';
import { createFeedWriters, loadWriterCatalog } from '../src/services/feed-writers.js';
import { commentPreference } from '../src/services/feed-personalization.js';
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../skills');

test('three reviewed writing packages retain their sources, scopes, hashes and licenses', () => {
  const catalog = loadWriterCatalog(); assert.equal(catalog.length, 3);
  assert.equal(catalog.find((w) => w.id === 'dbskill').license, 'CC BY-NC 4.0');
  assert.equal(catalog.find((w) => w.id === 'dbskill').sourceVersion, 'bab93c0376ced995c30cb841cb0d12622a430bcc');
  assert.ok(catalog.every((w) => w.rules.includes('醒课适配') && w.recipeHash.length === 64));
  assert.match(catalog.find((w) => w.id === 'bigpeng-hot-gzh').rules, /只负责选题与标题/);
  assert.match(catalog.find((w) => w.id === 'cheat-on-content').rules, /不是原版预测/);
});

test('a modified source cannot silently retain the reviewed recipe identity', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'synkore-writer-review-')); t.after(() => { const target = path.resolve(dir); if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith('synkore-writer-review-')) throw new Error('Unexpected fixture directory'); fs.rmSync(target, { recursive: true, force: true }); });
  for (const name of ['dbskill', 'cheat-on-content', 'bigpeng-hot-gzh']) fs.cpSync(path.join(sourceRoot, name), path.join(dir, name), { recursive: true });
  fs.appendFileSync(path.join(dir, 'dbskill/dbs-content/SKILL.md'), '\nchanged');
  assert.throws(() => loadWriterCatalog(dir), /来源校验失败/);
});

test('automatic selection varies by material and learned writing preferences without fixed quotas', () => {
  const writers = createFeedWriters(), posts = Array.from({ length: 150 }, (_, i) => ({ id: `p-${i}`, sourceHash: 'material', interest: '周杰伦', origin: i % 3 ? 'qa' : 'unclear', format: ['analysis', 'rebuttal', 'poem', 'lyrics'][i % 4] }));
  const count = (profile) => posts.map((post) => writers.choose(post, 'auto', profile)).reduce((out, writer) => (out[writer.id] = (out[writer.id] || 0) + 1, out), {});
  const initial = count({ enabled: true, values: [] }), preferred = count({ enabled: true, values: [{ feature: 'writer', value: 'dbskill', score: 6 }] });
  assert.equal(Object.keys(initial).length, 3); assert.ok(new Set(Object.values(initial)).size > 1);
  assert.ok(preferred.dbskill > initial.dbskill); assert.ok(preferred['cheat-on-content'] > 0 && preferred['bigpeng-hot-gzh'] > 0);
  assert.deepEqual(count({ enabled: false, values: [{ feature: 'writer', value: 'dbskill', score: 6 }] }), initial);
  assert.deepEqual(writers.choose(posts[0]), writers.choose(posts[0]));
  assert.throws(() => writers.choose(posts[0], 'unknown-method'), /没有这个创作方式/);
});

test('each writing method reaches a separate single-call prompt and records exact provenance', async (t) => {
  const f = fixture(); t.after(() => f.db.close()); const posts = f.service.list().posts;
  const labels = { dbskill: '清楚讲透', 'cheat-on-content': '观察与反转', 'bigpeng-hot-gzh': '选题与悬念' };
  for (const [index, id] of Object.keys(labels).entries()) {
    const post = posts[index], plan = f.service.plan(post.id, { writerId: id });
    assert.equal(plan.writer.id, id); assert.equal(plan.calls, 1); assert.equal(f.calls.length, index);
    await f.service.rewrite(post.id, { ...plan, approved: true });
    assert.equal(f.calls.length, index + 1); assert.equal(JSON.parse(f.calls[index][2]).writingMethod.id, id);
    assert.ok(f.calls[index][1].includes(`# 醒课适配：${labels[id]}`));
    for (const other of Object.keys(labels).filter((key) => key !== id)) assert.ok(!f.calls[index][1].includes(`# 醒课适配：${labels[other]}`));
    const saved = f.service.get(post.id); assert.equal(saved.writer.id, id); assert.equal(saved.writer.recipeHash, plan.writer.recipeHash);
    const body = saved.body; f.service.list(); assert.equal(f.service.get(post.id).body, body); assert.equal(f.service.get(post.id).writer.id, id);
    await f.service.rewrite(post.id, { ...plan, approved: true }); assert.equal(f.calls.length, index + 1);
  }
});

test('approved writing methods remain frozen, tampering and invalid selection cannot reach the provider', async (t) => {
  const f = fixture(); t.after(() => f.db.close()); const post = f.service.list().posts[0];
  assert.throws(() => f.service.plan(post.id, { writerId: '../other' }), /没有这个创作方式/);
  const plan = f.service.plan(post.id, { writerId: 'dbskill' });
  const original = JSON.parse(f.q1('SELECT context_json FROM learning_feed_writing_plans WHERE id=?', plan.planId).context_json);
  f.run('UPDATE learning_feed_writing_plans SET context_json=? WHERE id=?', JSON.stringify({ ...original, writer: { ...original.writer, id: 'cheat-on-content' } }), plan.planId);
  await assert.rejects(() => f.service.rewrite(post.id, { ...plan, approved: true }), /重新确认/); assert.equal(f.calls.length, 0);
  const next = f.service.plan(post.id, { writerId: 'cheat-on-content' });
  f.service.signal(post.id, { id: 'changed-taste', type: 'preference', value: 'less' });
  await f.service.rewrite(post.id, { ...next, writerId: 'bigpeng-hot-gzh', approved: true });
  assert.equal(JSON.parse(f.calls[0][2]).writingMethod.id, 'cheat-on-content');
});

test('writing feedback is attributed to actual generated articles, not local template placeholders', async (t) => {
  const f = fixture(); t.after(() => f.db.close()); const post = f.service.list().posts[0];
  f.service.signal(post.id, { id: 'placeholder-preference', type: 'preference', value: 'more' });
  assert.ok(!f.service.personalization.profile().values.some((s) => s.feature === 'writer'));
  await f.service.rewrite(post.id, { ...f.service.plan(post.id, { writerId: 'dbskill' }), approved: true });
  f.service.signal(post.id, { id: 'real-preference', type: 'preference', value: 'more' });
  assert.ok(f.service.personalization.profile().values.some((s) => s.feature === 'writer' && s.value === 'dbskill' && s.score > 0));
  const inferred = commentPreference('我更喜欢这种写法。', f.service.get(post.id), f.service.preferences().interests);
  assert.deepEqual(inferred.map((s) => [s.feature, s.value, s.direction]), [['writer', 'dbskill', 1]]);
});
