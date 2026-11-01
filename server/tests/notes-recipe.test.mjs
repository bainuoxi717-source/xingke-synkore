import test from 'node:test';
import assert from 'node:assert/strict';
import { NOTES_RECIPE_VERSION, prepareLectureSource, chunkLectureSource,
  normalizeChunkNote, generateLectureNotes, notesToMarkdown } from '../src/services/notes-recipe.js';

const row = (changes = {}) => ({ cour_id: 123, subj_name: '测试课程', teacher: '测试老师', leti_number: 2,
  begin_time: '2026-10-31 10:00:00', transcript: '', transcript_json: '[]', ppt_json: '[]', ...changes });
const answer = (refs = ['T1']) => JSON.stringify({ summary: '本段解释一个概念的适用条件。',
  outline: [{ title: '适用条件', points: ['需要先确认定义。'], refs }], concepts: [{ term: '概念', def: '在明确条件下适用。', refs }],
  cases: [], discussion: [], teacher_style: '', questions: ['适用条件是什么？'], key_quotes: [],
  review_questions: [{ question: '适用条件是什么？', answer: '材料说明需要先确认定义。', refs }],
  flashcards: [{ front: '适用前先做什么？', back: '确认定义。', refs }], citations: [{ claim: '需要先确认定义。', refs }], uncertainties: [] });

test('plain transcript fallback retains every character including the last section', () => {
  const text = '开头内容。'.repeat(1000) + '中段内容。'.repeat(7000) + '末尾重要结论。';
  const source = prepareLectureSource(row({ transcript: text }));
  const chunks = chunkLectureSource(source);
  assert.ok(chunks.length > 1);
  assert.equal(chunks.flatMap((chunk) => chunk.entries).map((entry) => entry.text).join(''), text);
  assert.equal(chunks.reduce((sum, chunk) => sum + chunk.characters, 0), text.length);
  assert.ok(chunks.every((chunk) => chunk.characters <= 22000));
  assert.equal(source.textSource, 'plain_transcript');
});

test('timed subtitles retain short statements and all OCR; unknown speaker stays unknown', () => {
  const source = prepareLectureSource(row({ transcript_json: JSON.stringify([{ text: '不', start: 0 }, { text: '是', start: 5000 }, { text: '结论', start: 6000 }]),
    speakers: JSON.stringify(['T', 'S']), ppt_json: JSON.stringify([{ ocr: '图示'.repeat(500) }]) }));
  assert.equal(source.units.length, 4);
  assert.equal(source.units[0].speaker, '老师');
  assert.equal(source.units[1].speaker, '同学');
  assert.equal(source.units[2].speaker, '未识别');
  assert.equal(source.units[3].text.length, 1000);
});

test('supplemental plain text prevents silent loss when timed transcript is incomplete', () => {
  const source = prepareLectureSource(row({ transcript: '第一部分\n第二部分未出现在时间轴', transcript_json: JSON.stringify([{ text: '第一部分', start: 1000 }]) }));
  assert.equal(source.supplemental, true);
  assert.ok(source.units.some((unit) => unit.text.includes('第二部分')));
  const equal = prepareLectureSource(row({ transcript: '第一 部分', transcript_json: JSON.stringify([{ text: '第一部分', start: 1000 }]) }));
  assert.equal(equal.supplemental, false);
});

test('hash changes with teacher, text, slide, timing or source identity', () => {
  const original = row({ transcript: '课堂正文'.repeat(100) });
  const initial = prepareLectureSource(original).sourceHash;
  assert.equal(initial, prepareLectureSource({ ...original }).sourceHash);
  for (const change of [{ teacher: '另一位老师' }, { transcript: original.transcript + '新内容' },
    { ppt_json: '[{"ocr":"新增课件"}]' }, { cour_id: 124 }, { begin_time: '2026-11-01 10:00:00' }]) {
    assert.notEqual(initial, prepareLectureSource({ ...original, ...change }).sourceHash);
  }
});

test('source refs and quotes are validated; fabricated time/speaker cannot survive', () => {
  const input = JSON.parse(answer(['S1', 'MADE-UP']));
  input.key_quotes = [{ text: '原文逐字句子', refs: ['S1'], time: '99:00', speaker: '老师' },
    { text: '不存在的原话', refs: ['S1'], time: '00:00', speaker: '老师' }];
  const output = normalizeChunkNote(input, [{ id: 'S1', text: '这句包含原文逐字句子。', speaker: '同学', time: '1:05' }]);
  assert.deepEqual(output.concepts[0].refs, ['S1']);
  assert.equal(output.key_quotes.length, 1);
  assert.equal(output.key_quotes[0].speaker, '同学');
  assert.equal(output.key_quotes[0].time, '1:05');
  assert.ok(output.uncertainties.some((text) => text.includes('无效来源')));
  assert.ok(output.uncertainties.some((text) => text.includes('逐字核对')));
});

test('sequential mock generation covers all chunks and creates one source-versioned note', async () => {
  const source = prepareLectureSource(row({ transcript: '测试正文。'.repeat(11000) + '最后的限制条件。' }));
  const prompts = [];
  const note = await generateLectureNotes(source, { model: 'mock', ask: async (_system, prompt) => { prompts.push(prompt); return answer(); } });
  assert.equal(prompts.length, chunkLectureSource(source).length);
  assert.ok(prompts.at(-1).includes('最后的限制条件。'));
  assert.equal(note._meta.sourceHash, source.sourceHash);
  assert.equal(note._meta.recipeVersion, NOTES_RECIPE_VERSION);
  assert.equal(note._meta.coverage.submittedCharacters, source.characters);
  assert.equal(note._meta.coverage.captureCompleteness, 'unknown');
  assert.equal(note._meta.model, 'mock');
  assert.ok(note.review_questions.length && note.flashcards.length);
});

test('malformed responses retry once per chunk; network errors are never retried', async () => {
  const source = prepareLectureSource(row({ transcript: '有效文字。'.repeat(100) }));
  let attempts = 0;
  const note = await generateLectureNotes(source, { ask: async () => ++attempts === 1 ? 'not json' : answer() });
  assert.equal(note._meta.modelCalls, 2);
  attempts = 0;
  await assert.rejects(generateLectureNotes(source, { ask: async () => { attempts++; return '{}'; } }), /已重试一次/);
  assert.equal(attempts, 2);
  attempts = 0;
  await assert.rejects(generateLectureNotes(source, { ask: async () => { attempts++; throw new Error('provider unavailable'); } }), /provider unavailable/);
  assert.equal(attempts, 1);
});

test('Markdown export supports both old and new note structures without claiming full recording coverage', async () => {
  const legacy = notesToMarkdown({ summary: '旧笔记', concepts: [{ term: '定义', def: '内容' }], questions: ['为什么？'] }, { subject: '历史课', teacher: '老师', lessonNumber: 1 });
  assert.match(legacy, /历史课 · 第1节笔记/);
  assert.match(legacy, /旧版笔记/);
  const source = prepareLectureSource(row({ transcript: '有效文字。'.repeat(100) }));
  const note = await generateLectureNotes(source, { ask: async () => answer() });
  const markdown = notesToMarkdown(note);
  assert.match(markdown, /复习问答/);
  assert.match(markdown, /速记卡/);
  assert.match(markdown, /来源索引/);
  assert.match(markdown, /不等同于完整课堂录像/);
});
