import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { customFixture, fixtureInput, profileResponse } from './custom-personas.fixture.mjs';
import { publicResearchURL } from '../src/services/custom-personas.js';
import { normalizeCustomProfile, NUWA_METHOD } from '../src/services/custom-persona-recipe.js';
let registryQuery = () => [];
mock.module('../src/db.js', { namedExports: { q: (...args) => registryQuery(...args) } });
const { listPersonas, getPersona, personaPrompt } = await import('../src/services/personas.js');

test('drafts preserve selected materials and expose unreadable attachments without model calls', async (t) => {
  const f = customFixture(); t.after(() => f.db.close());
  const input = { ...fixtureInput(), attachmentIds: ['12'] }; const result = await f.save(input);
  assert.equal(result.draft.sources.length, 3); assert.equal(result.draft.sources[2].text, '');
  assert.match(result.draft.sources[2].notice, /尚未接入/); assert.equal(f.calls.model.length, 0); assert.equal(f.calls.search.length, 0);
  assert.equal(f.service.config().method.repository, 'https://github.com/alchaincyf/nuwa-skill');
  assert.equal(f.service.get(f.id).draft.input.name, input.name);
});
test('exact quotes and distinct contexts constrain Nuwa candidate methods; unknown speech stays an observation', async (t) => {
  const f = customFixture(); t.after(() => f.db.close()); const { draft } = await f.save();
  const raw = profileResponse(draft.sources); assert.equal(normalizeCustomProfile(raw, draft.sources).methods[0].classification, '候选心智模型');
  const sameContext = draft.sources.map((s) => ({ ...s, context: '同一个领域' }));
  assert.equal(normalizeCustomProfile(raw, sameContext).methods[0].validation.crossContext, false);
  const unknown = draft.sources.map((s) => ({ ...s, attribution: 'unknown' }));
  const checked = normalizeCustomProfile(raw, unknown); assert.equal(checked.methods[0].classification, '局部观察'); assert.equal(checked.heuristics[0].evidence[0].kind, 'inference');
  raw.methods[0].evidence[0].quote = '这句话不在用户资料里'; assert.throws(() => normalizeCustomProfile(raw, draft.sources), /不在原资料/);
});
test('unapproved, changed, expired or unconfigured plans cannot reach a paid provider', async (t) => {
  const f = customFixture(); t.after(() => f.db.close()); await f.save();
  const plan = await f.approve(); await assert.rejects(() => f.service.execute(f.id, { planId: plan.id }), /确认/);
  await f.save({ ...fixtureInput(), goal: '改变讲解目的' }); await assert.rejects(() => f.execute(plan), /已变化/);
  const modelPlan = await f.approve(); f.settings.aiModel = 'changed-model'; await assert.rejects(() => f.execute(modelPlan), /已变化/);
  const keyPlan = await f.approve(); f.settings.deepseekKey = 'changed-key'; await assert.rejects(() => f.execute(keyPlan), /已变化/);
  const expired = await f.approve(); f.setNow('2026-11-01T05:00:00Z'); await assert.rejects(() => f.execute(expired), /已过期/);
  f.settings.deepseekKey = ''; const missing = await f.approve(); await assert.rejects(() => f.execute(missing), /Key/);
  assert.equal(f.calls.model.length, 0);
});
test('generation and simultaneous retries share one charge and produce an evidenced export', async (t) => {
  const f = customFixture(); t.after(() => f.db.close()); await f.save(); const plan = await f.approve();
  const results = await Promise.all([f.execute(plan), f.execute(plan)]);
  assert.equal(f.calls.model.length, 1); assert.ok(results.some((r) => r.draft.profile));
  assert.equal((await f.execute(plan)).duplicate, true); assert.equal(f.calls.model.length, 1);
  const markdown = await f.service.exportSkill(f.id); assert.match(markdown, /回答工作流/); assert.ok(markdown.includes(NUWA_METHOD.repository)); assert.match(markdown, /原始|数学课堂原文/);
  assert.match(f.calls.model[0][1], /心智模型识别的三重验证/); assert.match(f.calls.model[0][1], /不输出自我保真评分/);
});
test('only publication of the reviewed current version adds a selectable persona and updates its version', async (t) => {
  const f = customFixture(); t.after(() => f.db.close()); registryQuery = f.q;
  await f.save(); await f.execute(await f.approve()); assert.equal(listPersonas().filter((p) => p.kind === 'custom').length, 0);
  await assert.rejects(() => f.service.publish(f.id, { profileHash: 'stale' }), /预览版本/);
  const draft = f.service.get(f.id).draft, saved = await f.service.publish(f.id, { profileHash: draft.profileHash });
  const persona = getPersona(saved.personaId); assert.equal(persona.ready, true); assert.equal(persona.kind, 'custom'); assert.match(personaPrompt(persona), /例子与条件/);
  assert.equal(listPersonas().find((p) => p.id === persona.id).instructions, undefined);
  await f.save({ ...fixtureInput(), name: '更新后的讲师' }); await assert.rejects(() => f.service.publish(f.id, { profileHash: draft.profileHash }), /材料已改动/);
  await f.execute(await f.approve()); await f.service.publish(f.id, { profileHash: f.service.get(f.id).draft.profileHash });
  assert.notEqual(getPersona(saved.personaId).version, persona.version); assert.equal(f.q('SELECT * FROM custom_personas').length, 1);
});
test('source changes during a model call discard the result and retain the user material', async (t) => {
  const f = customFixture(); t.after(() => f.db.close()); await f.save(); const plan = await f.approve();
  f.setDuringModel(() => f.save({ ...fixtureInput(), goal: '另一种真实学习目标' }));
  const result = await f.execute(plan); assert.equal(result.ok, false); assert.match(result.error, /执行期间/);
  assert.equal(result.draft.profile, null); assert.equal(result.draft.input.goal, '另一种真实学习目标');
  await f.execute(plan); assert.equal(f.calls.model.length, 1);
});
test('provider failures preserve the previous profile and never retry automatically', async (t) => {
  const f = customFixture(); t.after(() => f.db.close()); await f.save(); await f.execute(await f.approve()); const original = f.service.get(f.id).draft.profileHash;
  f.setDuringModel(() => { throw new Error('simulated provider quota failure'); }); const plan = await f.approve(); const failed = await f.execute(plan);
  assert.equal(failed.ok, false); assert.equal(failed.draft.profileHash, original); await f.execute(plan); assert.equal(f.calls.model.length, 2);
});
test('an in-flight material read cannot overwrite a newer edit from another tab', async (t) => {
  let pause = false, release, entered;
  const gate = new Promise((resolve) => { release = resolve; }), started = new Promise((resolve) => { entered = resolve; });
  const f = customFixture({ readAttachments: async () => { if (pause) { entered(); await gate; } return []; } }); t.after(() => f.db.close());
  await f.save(); pause = true; const staleRead = f.service.sync(f.id); await started; pause = false;
  await f.save({ ...fixtureInput(), goal: '另一窗口刚刚保存的新目标' }); release();
  await assert.rejects(() => staleRead, /没有覆盖新内容/);
  assert.equal(f.service.get(f.id).draft.input.goal, '另一窗口刚刚保存的新目标');
});
test('research snippets alone cannot become a persona; only explicitly selected fetched pages enter sources', async (t) => {
  const f = customFixture(); t.after(() => f.db.close()); await f.save({ ...fixtureInput(), manual: [] });
  const search = await f.execute(await f.approve('search')); assert.equal(f.calls.search.length, 3); assert.equal(search.draft.candidates.length, 15); assert.equal(search.draft.sources.length, 0);
  await assert.rejects(() => f.approve('generate'), /搜索摘要/); assert.equal(f.calls.model.length, 0);
  const ids = search.draft.candidates.slice(0, 2).map((c) => c.id); const pages = await f.execute(await f.approve('fetch', ids));
  assert.equal(f.calls.fetch.length, 2); assert.equal(pages.draft.sources.length, 2); assert.ok(pages.draft.sources.every((s) => s.attribution === 'unknown' && s.kind === 'web'));
  assert.ok(pages.draft.sources.every((s) => f.calls.fetch.some((c) => c.url === s.url)));
});
test('research stops on quota failure, keeps successful candidates, and consumes the plan once', async (t) => {
  let count = 0; const f = customFixture({ search: async () => { count++; if (count === 2) throw new Error('quota'); return [{ title: '已取得的原文线索', url: 'https://example.com/first' }]; } }); t.after(() => f.db.close());
  await f.save(); const plan = await f.approve('search'); const result = await f.execute(plan);
  assert.equal(count, 2); assert.equal(result.ok, false); assert.equal(result.draft.candidates.length, 1); await f.execute(plan); assert.equal(count, 2);
});
test('changing accounts midway stops all remaining research requests', async (t) => {
  let count = 0; const f = customFixture({ search: async () => { count++; f.settings.deepseekKey = 'unapproved-account'; return []; } }); t.after(() => f.db.close());
  await f.save(); const result = await f.execute(await f.approve('search')); assert.equal(count, 1); assert.match(result.error, /账户发生变化/);
});
test('changed library material invalidates approval and oversized page excerpts disclose their coverage', async (t) => {
  const f = customFixture({ fetchPage: async () => ({ title: '较长原文', content: '原文'.repeat(12000) }) }); t.after(() => f.db.close());
  f.attachments.set('12', { id: '12', name: '原始文件', text: '旧资料'.repeat(100), status: 'read' });
  await f.save({ ...fixtureInput(), attachmentIds: ['12'] }); const old = await f.approve(); f.attachments.get('12').text = '新资料'.repeat(100);
  await assert.rejects(() => f.execute(old), /已变化/); assert.equal(f.calls.model.length, 0);
  const research = await f.execute(await f.approve('search')); const result = await f.execute(await f.approve('fetch', [research.draft.candidates[0].id]));
  const page = result.draft.sources.find((s) => s.kind === 'web'); assert.equal(page.text.length, 12000); assert.equal(page.totalChars, 24000); assert.match(page.notice, /仅读取/);
});
test('network references reject private hosts, non-web protocols and Nuwa excluded sources', () => {
  for (const url of ['file:///tmp/data', 'javascript:alert(1)', 'http://127.0.0.1/a', 'http://10.0.0.1', 'http://172.16.4.1', 'http://169.254.169.254', 'http://[::1]/', 'https://x.zhihu.com/a', 'https://mp.weixin.qq.com/s/1', 'https://baike.baidu.com/item/test', 'https://user:pass@example.com']) assert.equal(publicResearchURL(url), '', url);
  assert.equal(publicResearchURL('https://example.com/original#section'), 'https://example.com/original');
});
