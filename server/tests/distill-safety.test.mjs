// Run with: node --experimental-test-module-mocks --test tests/distill-safety.test.mjs
// Database and provider are mocked before importing the service; no real data or API is touched.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { prepareLectureSource, NOTES_RECIPE_VERSION } from '../src/services/notes-recipe.js';

const rows = new Map();
const writes = [];
let key = 'mock-key', calls = 0, failProvider = false, failureStatus = 0;
const result = JSON.stringify({ summary: '明确的课堂内容。', outline: [], concepts: [], questions: [], review_questions: [], flashcards: [], key_quotes: [], uncertainties: [] });
mock.module('../src/db.js', { namedExports: {
  q: (sql, ...params) => {
    if (sql.startsWith('PRAGMA')) return ['distill_json', 'distill_error', 'distill_attempt_hash'].map((name) => ({ name }));
    let items = [...rows.values()];
    if (sql.includes('teacher = ?')) items = items.filter((row) => row.teacher === params[0]);
    if (sql.includes('subj_name = ?')) items = items.filter((row) => row.subj_name === params.at(-1));
    return items;
  },
  q1: (_sql, id) => rows.get(Number(id)) || null,
  run: (sql, ...params) => {
    writes.push({ sql, params });
    if (sql.startsWith('UPDATE lectures SET distill_json')) Object.assign(rows.get(params[4]), { distill_json: params[0], distilled_at: params[1], distill_error: params[2], distill_attempt_hash: params[3] });
    else if (sql.startsWith('UPDATE lectures SET distill_error')) Object.assign(rows.get(params[2]), { distill_error: params[0], distill_attempt_hash: params[1] });
    else if (sql.startsWith('UPDATE lectures SET distill_attempt_hash')) Object.assign(rows.get(params[2]), { distill_attempt_hash: params[0], distill_error: params[1] });
    return { changes: 1 };
  },
  nowISO: () => '2026-10-31T10:00:00.000Z', getSettings: () => ({ deepseekKey: key, aiModel: 'mock-model' }),
} });
mock.module('../src/services/ai.js', { namedExports: { DEFAULT_MODEL: 'mock-model', askDeepSeek: async () => {
  calls++; if (failProvider) throw Object.assign(new Error('mock provider failure'), { status: failureStatus }); return result;
} } });
mock.module('../src/services/video.js', { namedExports: {
  acquireVideoToken: async () => {}, listVodCourses: async () => [{ teclId: 1, subjName: '测试课', teachers: '测试老师' }],
  listLectures: async () => [{ courId: 1, teclId: 1, subjName: '测试课', teacher: '测试老师', beginTime: '2026-01-01 09:00:00', endTime: '2026-01-01 10:00:00' }],
  getTranscript: async () => ({ text: '本地测试字幕。'.repeat(100), segments: [] }),
  getSummary: async () => null, getPptSlices: async () => [],
} });
const { listNoteTasks, planLectureNotes, distillLecture, distillPending } = await import('../src/services/distill.js');
const { ingestNewLectures } = await import('../src/services/ingest.js');
const make = (id = 1, extra = {}) => ({ cour_id: id, subj_name: '测试课', teacher: '测试老师', transcript: '课堂完整文字。'.repeat(80),
  transcript_json: '[]', ppt_json: '[]', distill_json: '', distill_error: '', distill_attempt_hash: '', ...extra });
const reset = (...items) => { rows.clear(); items.forEach((row) => rows.set(row.cour_id, row)); writes.length = 0; calls = 0; key = 'mock-key'; failProvider = false; failureStatus = 0; };

test('read-only queue classifies pending, legacy/stale, current, waiting and failed without writes', () => {
  const current = make(3); current.distill_json = JSON.stringify({ summary: '缓存', _meta: { sourceHash: prepareLectureSource(current).sourceHash, recipeVersion: NOTES_RECIPE_VERSION } });
  reset(make(1), make(2, { distill_json: '{"summary":"旧笔记"}' }), current, make(4, { transcript: '' }), make(5, { distill_error: '失败' }));
  const queue = listNoteTasks();
  assert.deepEqual(queue.items.map((item) => item.status), ['pending', 'stale', 'ready', 'waiting', 'error']);
  assert.equal(queue.items[1].hasNotes, true);
  assert.equal(queue.items[1].legacy, true);
  assert.equal(calls, 0); assert.equal(writes.length, 0);
});

test('unapproved generation/batch, missing source approval and changed source never call the provider', async () => {
  reset(make());
  assert.equal((await distillLecture(1)).needsConfirmation, true);
  assert.equal((await distillPending()).needsConfirmation, true);
  assert.equal((await distillLecture(1, { approved: true })).code, 'source_changed');
  const plan = planLectureNotes(1);
  rows.get(1).transcript += '新补充';
  assert.equal((await distillLecture(1, { approved: true, expectedSourceHash: plan.sourceHash, expectedRecipeVersion: NOTES_RECIPE_VERSION, expectedModel: 'mock-model' })).code, 'source_changed');
  assert.equal(calls, 0); assert.equal(writes.length, 0);
});

test('matching cache returns without approval or model calls', async () => {
  const current = make(); current.distill_json = JSON.stringify({ summary: '缓存', _meta: { sourceHash: prepareLectureSource(current).sourceHash, recipeVersion: NOTES_RECIPE_VERSION } });
  reset(current);
  const result = await distillLecture(1);
  assert.equal(result.ok, true); assert.equal(result.skipped, true); assert.equal(calls, 0); assert.equal(writes.length, 0);
});

test('approved exact version archives the previous note before replacing it', async () => {
  reset(make(1, { distill_json: '{"summary":"应保留的旧笔记"}' }));
  const plan = planLectureNotes(1);
  const output = await distillLecture(1, { approved: true, expectedSourceHash: plan.sourceHash, expectedRecipeVersion: NOTES_RECIPE_VERSION, expectedModel: 'mock-model' });
  assert.equal(output.ok, true); assert.equal(calls, 1);
  const archive = writes.find((write) => write.sql.startsWith('INSERT INTO lecture_note_versions'));
  assert.match(archive.params[1], /应保留的旧笔记/);
  assert.equal(JSON.parse(rows.get(1).distill_json)._meta.sourceHash, plan.sourceHash);
});

test('provider failure preserves old notes and records an error for this source version', async () => {
  const previous = '{"summary":"应保留的旧笔记"}';
  reset(make(1, { distill_json: previous })); failProvider = true;
  const plan = planLectureNotes(1);
  const output = await distillLecture(1, { approved: true, expectedSourceHash: plan.sourceHash, expectedRecipeVersion: NOTES_RECIPE_VERSION, expectedModel: 'mock-model' });
  assert.equal(output.ok, false); assert.equal(calls, 1);
  assert.equal(rows.get(1).distill_json, previous);
  assert.equal(listNoteTasks().items[0].status, 'error');
});

test('approved batch stays inside selected lectures; an added lecture remains pending', async () => {
  reset(make(1), make(2));
  const plan = planLectureNotes(1);
  const output = await distillPending({ approved: true, courIds: [1], expectedHashes: { 1: plan.sourceHash }, expectedRecipeVersion: NOTES_RECIPE_VERSION, expectedModel: 'mock-model' });
  assert.equal(output.done, 1); assert.equal(calls, 1);
  assert.equal(rows.get(2).distill_json, '');
  assert.equal(listNoteTasks().items.find((item) => item.courId === 2).status, 'pending');
});

test('a changed model or missing key never reaches the provider', async () => {
  reset(make());
  const plan = planLectureNotes(1);
  const approval = { approved: true, expectedSourceHash: plan.sourceHash, expectedRecipeVersion: NOTES_RECIPE_VERSION };
  assert.equal((await distillLecture(1, { ...approval, expectedModel: 'different-model' })).code, 'model_changed');
  key = '';
  assert.equal((await distillLecture(1, { ...approval, expectedModel: 'mock-model' })).code, 'missing_key');
  assert.equal(calls, 0); assert.equal(writes.length, 0);
});

test('provider quota failure stops the approved batch instead of retrying every remaining lesson', async () => {
  reset(make(1), make(2)); failProvider = true; failureStatus = 402;
  const plans = [planLectureNotes(1), planLectureNotes(2)];
  const output = await distillPending({ approved: true, courIds: [1, 2],
    expectedHashes: Object.fromEntries(plans.map((plan) => [plan.courId, plan.sourceHash])),
    expectedRecipeVersion: NOTES_RECIPE_VERSION, expectedModel: 'mock-model' });
  assert.equal(calls, 1); assert.equal(output.failed, 1); assert.equal(output.pending, 1);
  assert.equal(rows.get(2).distill_error, '');
});

test('lecture ingest only queues notes even with the old autoDistill:true flag', async () => {
  reset(make());
  const output = await ingestNewLectures({ force: true, autoDistill: true });
  assert.equal(output.updated, 1); assert.equal(output.queued, 1);
  assert.equal(output.distilled, 0); assert.equal(calls, 0);
  assert.equal(rows.get(1).distill_json, '');
});
