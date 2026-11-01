import { test } from 'node:test';
import assert from 'node:assert/strict';
import { customFixture, fixtureInput } from './custom-personas.fixture.mjs';
import { researchQueries } from '../src/services/custom-personas.js';

test('identity-aware research queries fit the provider 128-character limit', () => {
  const queries = researchQueries('人'.repeat(60), '身份'.repeat(100));
  assert.equal(queries.length, 3); assert.ok(queries.every((item) => [...item.query].length <= 128));
  assert.equal(researchQueries('人'.repeat(60), '身份'.repeat(100), true).length, 6);
  assert.ok(researchQueries('人'.repeat(60), '身份'.repeat(100), true).every((item) => [...item.query].length <= 128));
});

test('name discovery distinguishes people with quoted search evidence and requires one explicit plan approval', async (t) => {
  const f = customFixture(); t.after(() => f.db.close()); await f.save({ ...fixtureInput(), manual: [] });
  const plan = await f.approve('discover');
  assert.equal(plan.calls, 2); assert.equal(plan.maxToolCostUSD, .00075);
  await assert.rejects(() => f.service.execute(f.id, { planId: plan.id }), /确认/);
  assert.equal(f.calls.search.length + f.calls.model.length, 0);
  const result = await f.execute(plan);
  assert.equal(result.ok, true); assert.equal(result.draft.discovery.people.length, 2);
  assert.match(result.draft.discovery.people[0].description, /数学/);
  assert.match(result.draft.discovery.people[1].description, /作家/);
  assert.equal(result.draft.sources.length, 0, 'Search snippets never become distillation material');
  await f.execute(plan); assert.equal(f.calls.search.length, 1); assert.equal(f.calls.model.length, 1);
});

test('unsupported identities are rejected; empty search is different from a provider failure', async (t) => {
  const f = customFixture({ askDeepSeek: async () => JSON.stringify({ people: [{ name: '凭空编造', quote: '不在搜索中的身份', resultIds: ['r0'] }] }) }); t.after(() => f.db.close()); await f.save();
  assert.deepEqual((await f.execute(await f.approve('discover'))).draft.discovery.people, []);
  const empty = customFixture({ search: async () => [] }); t.after(() => empty.db.close()); await empty.save();
  assert.equal((await empty.execute(await empty.approve('discover'))).draft.discovery.searched, true);
  assert.equal(empty.calls.model.length, 0);
  const offline = customFixture({ search: async () => { throw Error('network unavailable'); } }); t.after(() => offline.db.close()); await offline.save();
  const failed = await offline.execute(await offline.approve('discover'));
  assert.equal(failed.ok, false); assert.equal(failed.draft.discovery, null);
});

test('automatic research binds selected identity, balances six dimensions and reads at most twenty originals', async (t) => {
  const f = customFixture(); t.after(() => f.db.close());
  await f.save({ ...fixtureInput(), mode: 'person', person: { id: 'p1', name: '测试讲师', description: '中学数学教师' }, manual: [] });
  const plan = await f.approve('research'); assert.equal(plan.maxToolCostUSD, .0195); assert.equal(plan.maxPages, 20);
  const result = await f.execute(plan);
  assert.equal(result.ok, true); assert.equal(f.calls.search.length, 6); assert.equal(f.calls.fetch.length, 20);
  assert.equal(f.calls.model.length, 0); assert.equal(result.draft.sources.length, 20);
  assert.equal(new Set(result.draft.sources.map((s) => s.dimension)).size, 6);
  assert.ok(f.calls.search.every((x) => x.query.includes('中学数学教师')));
  await f.execute(plan); assert.equal(f.calls.fetch.length, 20);
  const changed = await f.save({ ...fixtureInput(), mode: 'manual', name: '另一位讲师' });
  assert.equal(changed.draft.candidates.length, 0); assert.equal(changed.draft.sources.filter((s) => s.kind === 'web').length, 0);
});

test('a stopped research batch retains read originals and never retries paid calls', async (t) => {
  let count = 0;
  const f = customFixture({ fetchPage: async () => { if (++count === 3) throw Error('provider stopped'); return { content: '真实材料的推理和例子。'.repeat(40) }; } }); t.after(() => f.db.close()); await f.save({ ...fixtureInput(), manual: [] });
  const plan = await f.approve('research'), result = await f.execute(plan);
  assert.equal(result.ok, false); assert.equal(result.draft.sources.length, 2);
  await f.execute(plan); assert.equal(count, 3);
});

test('repeated research skips already read URLs and does not duplicate originals', async (t) => {
  const f = customFixture(); t.after(() => f.db.close()); await f.save({ ...fixtureInput(), manual: [] });
  await f.execute(await f.approve('research')); assert.equal(f.calls.fetch.length, 20);
  const again = await f.execute(await f.approve('research'));
  assert.equal(again.draft.sources.length, 30); assert.equal(f.calls.fetch.length, 30);
  const third = await f.execute(await f.approve('research'));
  assert.equal(third.ok, true); assert.equal(f.calls.fetch.length, 30);
});

test('research stops before creating a paid plan when material already fills the reading budget', async (t) => {
  const f = customFixture(); t.after(() => f.db.close());
  await f.save({ ...fixtureInput(), manual: Array.from({ length: 4 }, () => ({ text: '资'.repeat(20000) })) });
  await assert.rejects(() => f.approve('research'), /达到本次范围/);
  assert.equal(f.calls.search.length + f.calls.fetch.length + f.calls.model.length, 0);
});

test('twenty long original excerpts fit the generation plan without reverting to the old 48000-character limit', async (t) => {
  const f = customFixture({ fetchPage: async () => ({ content: '真实原文的论证。'.repeat(1000) }) }); t.after(() => f.db.close()); await f.save({ ...fixtureInput(), manual: [] });
  const result = await f.execute(await f.approve('research')); assert.equal(result.draft.sources.length, 20);
  const generation = await f.approve('generate'); assert.equal(generation.inputChars, 80000); assert.equal(generation.sources.length, 20);
});

test('an unavailable page is skipped while quota errors still stop the approved batch', async (t) => {
  let count = 0;
  const f = customFixture({ fetchPage: async () => { count++; if (count === 1) throw Object.assign(Error('not readable'), { status: 404 }); return { content: '这是有原始出处的材料。'.repeat(20) }; } }); t.after(() => f.db.close()); await f.save({ ...fixtureInput(), manual: [] });
  const result = await f.execute(await f.approve('research')); assert.equal(result.ok, true); assert.equal(result.draft.sources.length, 19); assert.equal(count, 20);
});
