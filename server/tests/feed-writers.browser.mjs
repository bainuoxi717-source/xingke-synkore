// End-to-end writing-method checks use only an isolated database and fake provider.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fixture } from './learning-feed.fixture.mjs';
import { createLearningFeedRouter } from '../src/services/learning-feed.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), f = fixture(), app = express();
app.use(express.json()); app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/learning-feed', createLearningFeedRouter(f.service)); app.use('/api', (req, res) => res.status(404).json({ error: 'Not used by this fixture' }));
app.use(express.static(path.join(root, 'web/dist'))); app.get('*', (req, res) => res.sendFile(path.join(root, 'web/dist/index.html')));
const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); }), base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 849, height: 1004 }, reducedMotion: 'reduce' }), errors = [];
  page.on('pageerror', (e) => errors.push(e.message)); await page.goto(base + '/learning-feed', { waitUntil: 'networkidle' });
  await page.locator('.feed-card-cover').first().click(); const reader = page.getByRole('dialog');
  const select = reader.getByLabel('选择创作方式'); await select.waitFor(); await page.waitForFunction(() => document.querySelector('select[aria-label="选择创作方式"]')?.options.length === 4);
  assert.equal(await select.inputValue(), 'auto');
  const button = reader.getByRole('button', { name: 'AI 成篇＋观点评论', exact: true });
  const ids = ['dbskill', 'cheat-on-content', 'bigpeng-hot-gzh'];
  for (const [index, id] of ids.entries()) {
    await select.selectOption(id); await button.click();
    await reader.locator('.feed-writer-source').filter({ hasText: id }).waitFor();
    assert.equal(f.calls.length, index + 1); assert.equal(JSON.parse(f.calls[index][2]).writingMethod.id, id);
  }
  const postId = new URL(page.url()).searchParams.get('post'); await page.reload({ waitUntil: 'networkidle' });
  await reader.locator('.feed-writer-source').filter({ hasText: 'bigpeng-hot-gzh' }).waitFor();
  assert.equal(f.service.get(postId).writer.id, 'bigpeng-hot-gzh'); assert.equal(await select.inputValue(), 'auto');
  await page.setViewportSize({ width: 390, height: 844 }); await select.scrollIntoViewIfNeeded();
  assert.ok(await reader.evaluate((e) => e.scrollWidth <= e.clientWidth));
  await page.screenshot({ path: path.join(root, 'docs/feed-writing-methods-mobile.png') });
  assert.deepEqual(errors, []);
  console.log('PASS: automatic/manual writing styles, calls without reminder, three separate simulated article methods, single-call provenance, reload and mobile. No user data or paid APIs touched.');
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); f.db.close(); }
