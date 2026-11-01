import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSourceRef, resolveLearningSourceMetadata, readSelectedSources, selectedSourceScope, selectedSourcesPrompt } from './learning-sources.js';
import { notesToMarkdown } from './notes-recipe.js';

const lecture = { cour_id: 7, subj_name: '微积分', teacher: '原老师', begin_time: '2026-10-21', leti_number: 3, distill_json: JSON.stringify({ summary: '导数是局部变化率', concepts: [{ term: '导数', def: '变化率' }] }) };
const deps = {
  filesDir: '.', notesToMarkdown,
  q1(sql, id) {
    if (sql.includes('lectures')) return id === 7 ? lecture : null;
    if (sql.includes("source='agent-upload'")) return id === 9 ? { id: 9, name: 'image.png', local_path: '' } : null;
    return id === 12 ? { id: 12, name: '课件.pdf', course_id: 5, course_name: '微积分', downloaded: 0 } : null;
  },
};
test('library references resolve from trusted records and reject invalid references', () => {
  assert.equal(parseSourceRef('lecture-note:0'), null);
  assert.equal(parseSourceRef('material:../../secret'), null);
  assert.equal(parseSourceRef('lecture-note:9007199254740992'), null);
  const records = resolveLearningSourceMetadata(['lecture-note:7', 'lecture-note:7', 'lecture-note:8'], deps);
  assert.equal(records.length, 1);
  assert.equal(records[0].teacher, '原老师');
  assert.equal(records[0].row, undefined);
});
test('a selected lesson note contributes actual text and constrains the lesson, independently of persona', async () => {
  const sources = await readSelectedSources(['lecture-note:7'], deps);
  assert.equal(sources[0].status, 'read');
  assert.match(sources[0].text, /微积分 · 第3节/);
  assert.match(sources[0].text, /导数是局部变化率/);
  assert.match(sources[0].text, /原老师/);
  assert.deepEqual(selectedSourceScope({ teacher: '另一位老师' }, sources), { courIds: [7] });
  assert.match(selectedSourcesPrompt(sources), /\[资料1\]/);
  assert.match(selectedSourcesPrompt(sources), /二次整理/);
});
test('unreadable attachments never claim to be parsed or silently select unrelated classes', async () => {
  const sources = await readSelectedSources(['material:12', '9', 'lecture-note:99'], deps);
  assert.equal(sources.length, 3);
  assert.equal(sources[0].status, 'unavailable');
  assert.equal(sources[1].text, '');
  assert.equal(sources[2].status, 'unavailable');
  assert.deepEqual(selectedSourceScope({}, sources), { courseId: 5 });
  assert.deepEqual(selectedSourceScope({}, [sources[1]]), { courIds: [-1] });
});
test('large notes disclose partial reading and stop at a shared context budget', async () => {
  const large = { ...deps, q1: () => ({ ...lecture, distill_json: JSON.stringify({ summary: '字'.repeat(20000) }) }) };
  const sources = await readSelectedSources(['lecture-note:7', 'lecture-note:8', 'lecture-note:9', 'lecture-note:10'], large);
  assert.equal(sources[0].status, 'partial');
  assert.equal(sources[3].status, 'omitted');
  assert.equal(sources.reduce((sum, source) => sum + source.text.length, 0), 36000);
});
