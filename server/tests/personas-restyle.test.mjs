// node --experimental-test-module-mocks --test tests/personas-restyle.test.mjs
// Both database and provider are mocked. No user data or external AI is touched.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const rows = new Map(), styles = new Map(), cache = new Map();
let calls = [], onProvider = null, styleResponse = {}, styleCalls = 0;
mock.module('../src/db.js', { namedExports: {
  q: (sql, ...params) => {
    if (sql.includes('FROM teacher_styles')) return [...styles.values()];
    let items = [...rows.values()];
    if (sql.includes('teacher = ?')) items = items.filter((row) => row.teacher === params.at(-1));
    if (sql.includes('subj_name = ?')) items = items.filter((row) => row.subj_name === params[0]);
    if (sql.includes('GROUP BY teacher')) return [...new Set(items.map((row) => row.teacher))].map((teacher) => ({ teacher, lectures: 1 }));
    return items;
  },
  q1: (sql, ...params) => sql.includes('FROM restyle_cache') ? cache.get(JSON.stringify(params)) : rows.get(Number(params[0])) || null,
  run: (sql, ...params) => {
    if (sql.startsWith('INSERT INTO restyle_cache')) cache.set(JSON.stringify(params.slice(0, 3)), { markdown: params[3], created_at: params[4] });
    return { changes: 1 };
  },
  nowISO: () => '2026-10-31T10:00:00.000Z',
  getSettings: () => ({ deepseekKey: 'test-mock-key', aiModel: 'test-model' }),
} });
mock.module('../src/services/ai.js', { namedExports: {
  DEFAULT_MODEL: 'test-model',
  askDeepSeek: async () => { styleCalls++; return JSON.stringify(styleResponse); },
  askDeepSeekStream: async (key, system, user, options, onDelta) => {
    calls.push({ system, user, options });
    if (onProvider) await onProvider(options);
    onDelta('模拟讲解 [源1]');
    return '模拟讲解 [源1]';
  },
} });
const { loadSkillPersonas, listPersonas, getPersona, personaPrompt, teacherPersonaId } = await import('../src/services/personas.js');
const { prepareSourceSegments, splitSourceChunks, sourceExcerptText, buildRestylePrompt, restyleCacheFingerprint,
  resolveRestylePersona, restyleStream, runCancellableBatch, cachePut, cacheGet, sourceMaterial } = await import('../src/services/restyle.js');
const { sampleTeacherLectures, buildTeacherDistillationPrompt, normalizeStyleEvidence, buildStyle, TEACHER_DISTILL_VERSION } = await import('../src/services/restyle.js');

function fixture(extra = {}) {
  rows.clear(); styles.clear(); cache.clear(); calls = []; onProvider = null; styleCalls = 0; styleResponse = {};
  const segments = [{ text: '甲'.repeat(4000), start: 1000 }, { text: '乙'.repeat(4000), start: 2000 }, { text: '丙'.repeat(1500), start: 3000 }];
  const row = { cour_id: 1, subj_name: '原课程', teacher: '原老师', begin_time: '2026-10-30', leti_number: 2,
    transcript: segments.map((segment) => segment.text).join(''), transcript_json: JSON.stringify(segments), distill_json: '', speakers: '["T","S","T"]', ...extra };
  rows.set(1, row);
  return row;
}

test('teacher selection reads existing styles and does not generate missing profiles', () => {
  fixture();
  const id = teacherPersonaId('原老师');
  assert.equal(listPersonas().find((item) => item.id === id).ready, false);
  assert.throws(() => resolveRestylePersona('', id), /尚未蒸馏/);
  styles.set('原老师', { teacher: '原老师', style_json: '{"一句话风格":"先例子后概念"}', samples: 8000 });
  assert.equal(getPersona(id).ready, true);
  assert.match(personaPrompt(getPersona(id)), /先例子后概念/);
  assert.equal(calls.length, 0);
  assert.equal(styleCalls, 0);
});

test('nuwa teaching samples exclude known students and retain IDs, versions and speaker uncertainty', () => {
  const row = fixture();
  const samples = sampleTeacherLectures([row]);
  assert.ok(samples.samples.length > 0);
  assert.ok(samples.samples.every((sample) => sample.speaker === 'teacher'));
  assert.doesNotMatch(samples.text, /乙/);
  assert.equal(samples.sources[0].courId, 1);
  const unknown = sampleTeacherLectures([{ ...row, speakers: '["S","?","S"]' }]);
  assert.ok(unknown.samples.every((sample) => sample.speaker === 'unknown'));
  assert.match(unknown.text, /说话人未知，不可认定为老师原话/);
  assert.notEqual(samples.sampleVersion, unknown.sampleVersion);
  const prompt = buildTeacherDistillationPrompt('原老师', samples);
  for (const field of ['thinking_methods', 'reasoning_sequence', 'heuristics', 'boundaries', 'style_evidence']) assert.ok(prompt.user.includes(field));
  assert.match(prompt.user, /女娲教学适配流程/);
  assert.match(prompt.user, /跨至少两个情境/);
});

test('style evidence rejects fabricated quotations and cannot certify unknown speakers as teacher habits', () => {
  const samples = [{ id: '样本1', speaker: 'unknown', subject: '课一', text: '先提出问题再找条件' }];
  const result = normalizeStyleEvidence({
    '一句话风格': '先提问', '口头禅': ['先提出问题'],
    thinking_methods: [
      { name: '可观察方法', validation: { cross_context: true, generative: true, distinctive: true }, evidence: [{ sample_id: '样本1', quote: '先提出问题', kind: 'direct' }] },
      { name: '编造方法', evidence: [{ sample_id: '样本1', quote: '不存在的原话', kind: 'direct' }] },
    ], style_evidence: { '一句话风格': [{ sample_id: '样本1', quote: '先提出问题', kind: 'direct' }] },
  }, samples);
  assert.equal(result.thinking_methods.length, 1);
  assert.equal(result.thinking_methods[0].classification, 'observation');
  assert.equal(result.thinking_methods[0].evidence[0].kind, 'inference');
  assert.match(result['一句话风格'], /样本不足/);
  assert.deepEqual(result['口头禅'], []);
  assert.ok(result.gaps.some((gap) => gap.includes('说话人未知')));
});

test('explicit teacher distillation records nuwa recipe, exact sample provenance and model without real provider access', async () => {
  const row = fixture();
  const samples = sampleTeacherLectures([row]);
  const proof = { sample_id: samples.samples[0].id, quote: samples.samples[0].text.slice(0, 8), kind: 'pattern' };
  styleResponse = { '一句话风格': '从例子归纳', thinking_methods: [{ name: '归纳', rule: '先例子再条件', evidence: [proof], validation: { generative: true } }],
    style_evidence: { '一句话风格': [proof] } };
  const result = await buildStyle('原老师', { force: true });
  assert.equal(styleCalls, 1);
  assert.equal(result._meta.recipeVersion, TEACHER_DISTILL_VERSION);
  assert.equal(result._meta.sampleVersion, samples.sampleVersion);
  assert.equal(result._meta.sourceLectures[0].courId, 1);
  assert.equal(result._meta.model, 'test-model');
  assert.ok(result.thinking_methods[0].evidence.length);
  assert.match(result._meta.reviewStatus, /待人工/);
});

test('skill registry loads reviewed content, versions prompt changes and rejects escaped paths and duplicate IDs', (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-registry-test-'));
  const directory = path.join(tempRoot, 'personas'); fs.mkdirSync(directory);
  t.after(() => { assert.equal(path.dirname(tempRoot), fs.realpathSync(os.tmpdir())); fs.rmSync(tempRoot, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(directory, 'TEACHING.md'), '先让学生用自己的话解释。');
  fs.writeFileSync(path.join(directory, 'a.json'), JSON.stringify({ id: 'test-person', name: '测试人物', promptFile: 'TEACHING.md' }));
  const first = loadSkillPersonas(directory)[0];
  assert.equal(first.id, 'skill:test-person'); assert.equal(first.ready, true);
  fs.writeFileSync(path.join(directory, 'TEACHING.md'), '先让学生用自己的话解释，再给反例。');
  assert.notEqual(first.version, loadSkillPersonas(directory)[0].version);
  fs.writeFileSync(path.join(tempRoot, 'outside.md'), '不应加载');
  fs.writeFileSync(path.join(directory, 'b.json'), JSON.stringify({ id: 'escape', name: '错误路径', promptFile: '../outside.md' }));
  fs.writeFileSync(path.join(directory, 'c.json'), JSON.stringify({ id: 'test-person', name: '重复人物', instructions: '测试' }));
  const result = loadSkillPersonas(directory);
  assert.equal(result.filter((item) => item.ready).length, 1);
  assert.equal(result.filter((item) => !item.ready).length, 2);
});

test('all source content survives chunking with stable IDs, time and speaker attribution', () => {
  const row = fixture(); const source = sourceMaterial(1);
  const segments = prepareSourceSegments(source);
  assert.equal(segments.map((segment) => segment.text).join(''), row.transcript);
  assert.deepEqual(segments.map((segment) => segment.id), [1, 2, 3, 4, 5]);
  assert.equal(splitSourceChunks(segments).flat().map((segment) => segment.text).join(''), row.transcript);
  assert.match(sourceExcerptText(segments[2]), /^\[源3\] 【0:02 · 同学】/);
  assert.throws(() => prepareSourceSegments(source, 0), /正整数/);
  const prompt = buildRestylePrompt({ source, persona: null, mode: 'full', segments: [segments[2]], chunkCount: 2, chunkIndex: 1 });
  assert.match(prompt.user, /\[源3\]/); assert.doesNotMatch(prompt.user, /\[源1\]/);
  assert.match(prompt.system, /第 2\/2 段原文/); assert.match(prompt.system, /不声称已覆盖整节课/);
});

test('streaming provides every excerpt once and stores its source index without attributing it to a persona', async () => {
  fixture();
  const result = await restyleStream({ courId: 1 });
  assert.equal(calls.length, 2);
  const citedIds = calls.flatMap((call) => [...call.user.matchAll(/\[源(\d+)\]/g)].map((match) => Number(match[1])));
  assert.deepEqual(citedIds, [1, 2, 3, 4, 5]);
  assert.equal(result.sourceTeacher, '原老师'); assert.equal(result.personaId, '');
  assert.equal(result.coverage.sourceProvided, 'all');
  assert.match(result.markdown, /### 原文索引/); assert.match(result.markdown, /\[源5\]/);
});

test('cache fingerprint changes with source, persona version and model; changed input cannot receive an old result', () => {
  fixture(); const source = sourceMaterial(1);
  const input = { source, persona: { id: 'skill:test', version: '1' }, mode: 'full', model: 'first' };
  const hash = restyleCacheFingerprint(input);
  assert.notEqual(hash, restyleCacheFingerprint({ ...input, persona: { id: 'skill:test', version: '2' } }));
  assert.notEqual(hash, restyleCacheFingerprint({ ...input, model: 'second' }));
  assert.notEqual(hash, restyleCacheFingerprint({ ...input, source: { lec: { ...source.lec, transcript: '已更新' } } }));
  const expected = restyleCacheFingerprint({ source, persona: null, mode: 'full', model: 'test-model' });
  cachePut(1, '', 'full', '正确缓存', '', expected);
  assert.equal(cacheGet(1, '', 'full').markdown, '正确缓存');
  rows.get(1).transcript += '新资料';
  assert.equal(cacheGet(1, '', 'full'), null);
  cachePut(1, '', 'full', '不应保存', '', expected);
  assert.equal(cacheGet(1, '', 'full'), null);
});

test('cancellation stops later segments and later batch items', async () => {
  fixture();
  const generation = new AbortController();
  onProvider = () => generation.abort();
  await assert.rejects(restyleStream({ courId: 1, signal: generation.signal }), { name: 'AbortError' });
  assert.equal(calls.length, 1);
  const batch = new AbortController(), visited = [];
  await assert.rejects(runCancellableBatch([1, 2, 3], batch.signal, async (item) => { visited.push(item); batch.abort(); }), { name: 'AbortError' });
  assert.deepEqual(visited, [1]);
});
