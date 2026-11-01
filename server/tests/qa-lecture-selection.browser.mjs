// Exact lecture scope and surname-only labels, with isolated fake data/providers.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), app = express(), submissions = [];
const ttsRequests = [];
let voiceFailure = false;
const firstTeacher = '张明明', team = '欧阳文文、李成成';
const lectures = [
  { cour_id: 101, subj_name: '示例数学', teacher: firstTeacher, begin_time: '2026-10-20 08:00:00', leti_number: 3, transcript_chars: 500 },
  { cour_id: 102, subj_name: '示例数学', teacher: firstTeacher, begin_time: '2026-10-12 08:00:00', leti_number: 2, transcript_chars: 600 },
  { cour_id: 202, subj_name: '示例研究方法', teacher: team, begin_time: '2026-09-15 10:00:00', leti_number: 1, transcript_chars: 700 },
  { cour_id: 203, subj_name: '示例研究方法', teacher: team, begin_time: '2026-09-22 10:00:00', leti_number: 2, transcript_chars: 0 },
];
const personas = [{ id: 'skill:feynman', name: '费曼', kind: 'skill', ready: true, version: 'test' }, { id: 'teacher:test', name: firstTeacher, teacher: firstTeacher, kind: 'teacher', ready: true, version: 'test-teacher' }];
app.use(express.json());
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/api/personas', (req, res) => res.json({ personas }));
app.get('/api/voices/status', (req, res) => res.json({ enabled: true, hasKey: true, teachers: [{ teacher: firstTeacher, hasVoice: true }, { teacher: team, hasVoice: true }] }));
app.get('/api/tts', (req, res) => { ttsRequests.push(req.query); if (voiceFailure) res.status(502).json({ error: '合成失败：insufficient balance' }); else res.type('audio/mpeg').send(Buffer.alloc(100)); });
app.get('/api/qa/scopes', (req, res) => res.json({ teachers: [{ teacher: firstTeacher }, { teacher: team }], lectures: lectures.slice(0, 1), stats: { teachers: 2, lectures: 4, ready: 3, totalWan: 1 } }));
app.get('/api/lectures', (req, res) => res.json({ lectures }));
app.get('/api/lectures/:id', (req, res) => res.json({ lecture: { ...lectures.find((item) => item.cour_id === Number(req.params.id)), transcript: '具体例子与成立条件。'.repeat(40) } }));
app.get('/api/qa/sessions', (req, res) => res.json({ sessions: [{ id: 1, title: `请${firstTeacher}解释概念`, teacher: firstTeacher, message_count: 2, updated_at: '2026-11-01' }] }));
app.get('/api/qa/sessions/1', (req, res) => res.json({ session: { teacher: firstTeacher, mode: 'teacher' }, messages: [{ role: 'user', text: `请${firstTeacher}解释`, scope: { courIds: [202] } }, { role: 'assistant', text: `${team}的课堂解释`, teacher: team, personaId: 'skill:feynman' }] }));
app.get('/api/qa/call-plan', (req, res) => res.json({ configured: true, model: 'fake-model', calls: 1 }));
app.post('/api/qa/lecture/stream', (req, res) => {
  submissions.push(req.body);
  res.type('text/event-stream').send(`event: evidence\ndata: ${JSON.stringify({ teacher: firstTeacher, personaId: 'teacher:test', personaName: firstTeacher, citations: [{ date: '2026-10-12', leti: 2, quote: `${firstTeacher}解释原文`, speaker: '老师' }] })}\n\nevent: delta\ndata: ${JSON.stringify({ text: `${firstTeacher}用例子解释【2026-10-12 第2节 00:05】` })}\n\nevent: done\ndata: ${JSON.stringify({ ok: true, sessionId: 0, full: `${firstTeacher}用例子解释【2026-10-12 第2节 00:05】` })}\n\n`);
});
app.get('/api/custom-personas/config', (req, res) => res.json({ configured: false, method: {}, drafts: [] }));
app.get('/api/custom-personas/drafts/:id', (req, res) => res.status(404).json({ error: 'No draft' }));
app.get('/api/restyle/scopes', (req, res) => res.json({ courses: [{ subject: '示例数学', teacher: firstTeacher, lectures: 2 }, { subject: '示例研究方法', teacher: team, lectures: 2 }], teachers: [], personas }));
app.get('/api/restyle/lectures', (req, res) => res.json({ lectures: lectures.filter((item) => item.subj_name === req.query.subject && item.teacher === req.query.teacher).map((item) => ({ ...item, chars: item.transcript_chars })) }));
app.get('/api/restyle/cached', (req, res) => res.json({ cached: false }));
app.get('/api/restyle/batch/status', (req, res) => res.json({ running: false }));
app.get('/api/learning-sources/:id', (req, res) => res.json({ attachment: { id: req.params.id, kind: 'lecture-note', courId: 202, leti: 1, courseName: '示例研究方法', teacher: team, name: '示例研究方法 · 第1节', size: 0, content_type: 'text/markdown' } }));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not used in this isolated test' }));
app.use(express.static(path.join(root, 'web/dist'))); app.get('*', (req, res) => res.sendFile(path.join(root, 'web/dist/index.html')));
const server = await new Promise((resolve) => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); }), base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.SYNKORE_BROWSER_CHANNEL ? { channel: process.env.SYNKORE_BROWSER_CHANNEL } : {}) }), errors = [], dialogs = [];
try {
  const page = await browser.newPage({ viewport: { width: 849, height: 1004 } }); page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); }); page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.__voicePlays = 0; window.__voicePauses = 0; window.__systemPlays = 0;
    window.Audio = class { play() { window.__voicePlays++; this.timer = setTimeout(() => this.onended?.(), 150); return Promise.resolve(); } pause() { window.__voicePauses++; clearTimeout(this.timer); } };
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { speak(utterance) { window.__systemPlays++; setTimeout(() => utterance.onend?.(), 0); }, cancel() {} } });
  });
  await page.goto(base + '/qa', { waitUntil: 'networkidle' });
  const source = page.getByLabel('选择课堂课次'), restyle = page.getByRole('button', { name: '换个讲法', exact: true });
  assert.equal(await source.locator('option').count(), 5, 'Full catalog includes older lectures outside the scopes preview');
  assert.equal(await source.locator('optgroup').nth(1).getAttribute('label'), '示例研究方法 · 欧阳老师、李老师');
  assert.equal(await source.locator('option[value="203"]').isDisabled(), true);
  assert.equal(await restyle.isDisabled(), true);
  assert.equal(await page.locator('.qa-hist-meta').innerText().then((v) => v.includes(firstTeacher)), false);
  assert.match(await page.locator('.qa-hist-title').innerText(), /张老师/);
  await source.selectOption('102'); await page.getByLabel('选择讲解人物').selectOption('skill:feynman');
  await page.getByRole('textbox', { name: '课堂问题' }).fill('用例子讲一下');
  await page.getByRole('button', { name: '发送课堂问题' }).click();
  await page.getByText('张老师用例子解释', { exact: false }).waitFor();
  assert.deepEqual(submissions[0].sourceScope, { courIds: [102], teacher: firstTeacher });
  assert.equal(submissions[0].personaId, 'skill:feynman');
  assert.ok(!(await page.locator('.qa-answer').last().innerText()).includes(firstTeacher));
  assert.ok(!(await page.locator('.cite-inline').getAttribute('title')).includes(firstTeacher));
  const voiceSelect = page.getByLabel('选择朗读音色'), readButton = page.getByRole('button', { name: '朗读', exact: true });
  assert.equal(await voiceSelect.locator('option').count(), 3);
  await voiceSelect.selectOption(firstTeacher); await readButton.click();
  await page.waitForFunction(() => window.__voicePlays === 1);
  assert.equal(ttsRequests[0].teacher, firstTeacher);
  await readButton.click(); assert.ok(await page.evaluate(() => window.__voicePauses > 0));
  await voiceSelect.selectOption(team); await readButton.click(); await page.waitForFunction(() => window.__voicePlays === 2);
  assert.equal(ttsRequests[1].teacher, team, 'The selected voice is independent of Feynman explanation');
  await page.waitForTimeout(200); voiceFailure = true;
  await readButton.click(); await page.getByRole('alert').filter({ hasText: '余额不足' }).waitFor();
  assert.equal(await page.evaluate(() => window.__systemPlays), 0, 'A failed cloned voice must not silently play a different voice');
  voiceFailure = false; await voiceSelect.selectOption(''); await readButton.click(); await page.waitForFunction(() => window.__systemPlays === 1);
  await voiceSelect.selectOption(team);
  await page.reload({ waitUntil: 'networkidle' }); assert.equal(await source.inputValue(), '102');
  await page.getByLabel('选择讲解人物').selectOption('__custom__');
  assert.match(new URL(page.url()).searchParams.get('returnTo'), /courId=102/);
  await page.getByRole('link', { name: '返回学习', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('select[aria-label="选择课堂课次"]')?.value === '102');
  assert.equal(await source.inputValue(), '102');
  await page.locator('.qa-hist-item').click(); await page.getByText('欧阳老师、李老师的课堂解释', { exact: false }).waitFor();
  assert.equal(await source.inputValue(), '202', 'History restores its saved exact lecture scope');
  await source.selectOption('102'); await restyle.click(); await page.waitForURL('**/restyle?**');
  assert.equal(new URL(page.url()).searchParams.get('courId'), '102'); assert.equal(new URL(page.url()).searchParams.get('personaId'), 'skill:feynman');
  assert.equal(await page.getByLabel('选择朗读音色').inputValue(), team, 'Voice preference also persists into restyling');
  await page.locator('.ln-item.active').waitFor(); assert.match(await page.locator('.ln-item.active').innerText(), /第2节/);
  assert.ok(!(await page.locator('.ln-main').innerText()).includes(firstTeacher));
  await page.screenshot({ path: path.join(root, 'docs/qa-restyle-exact-lecture-fixture.png') });
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); mobile.on('pageerror', (error) => errors.push(error.message));
  await mobile.goto(base + '/qa', { waitUntil: 'networkidle' }); await mobile.getByLabel('选择课堂课次').selectOption('202');
  assert.equal(await mobile.getByRole('button', { name: '换个讲法', exact: true }).isEnabled(), true);
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await mobile.screenshot({ path: path.join(root, 'docs/qa-lecture-selection-mobile-fixture.png') });
  await mobile.evaluate(() => sessionStorage.setItem('personal-agent:qa-attachment-draft', JSON.stringify(['lecture-note:202'])));
  await mobile.reload({ waitUntil: 'networkidle' }); await mobile.locator('.attachment-ready').waitFor();
  assert.equal(await mobile.getByLabel('选择课堂课次').isDisabled(), true);
  await mobile.getByRole('button', { name: '换个讲法', exact: true }).click(); await mobile.waitForURL('**/restyle?**');
  assert.equal(new URL(mobile.url()).searchParams.get('courId'), '202');
  assert.equal(submissions.length, 1); assert.deepEqual(errors, []); assert.deepEqual(dialogs, []);
  console.log('PASS: full lesson catalog, exact QA/restyle scope, surname privacy, no call reminders, selectable cloned/system voices, independent voice preference, stopping, balance-error reporting, draft/custom/history return, attachment scope and mobile. Fake providers/audio only.');
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
