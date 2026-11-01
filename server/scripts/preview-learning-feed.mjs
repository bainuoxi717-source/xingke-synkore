// Read-only visual inspection: suppresses every mutation and all reading signals.
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1120, height: 1000 }, reducedMotion: 'reduce' }), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/**', (route) => route.request().method() === 'GET' ? route.continue() : route.fulfill({ json: { ok: true } }));
  await page.goto('http://localhost:3930/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => ['ready', 'fallback'].includes(document.querySelector('.mascot-3d')?.dataset.status));
  assert.equal(await page.locator('#agent-prompt,#learning-feed').count(), 0);
  await page.screenshot({ path: path.join(root, 'docs/home-planets-only-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(root, 'docs/home-planets-only-mobile.png') });
  await page.getByRole('button', { name: '个性化助手', exact: true }).click(); await page.locator('#agent-prompt').waitFor();
  await page.screenshot({ path: path.join(root, 'docs/assistant-standalone-mobile.png') });
  await page.setViewportSize({ width: 849, height: 1004 });
  await page.screenshot({ path: path.join(root, 'docs/assistant-standalone-desktop.png') });
  await page.getByRole('link', { name: 'synkore·醒课 首页' }).click();
  await page.getByRole('button', { name: '信息流学习', exact: true }).click();
  assert.equal(new URL(page.url()).pathname, '/learning-feed');
  await page.setViewportSize({ width: 1120, height: 1000 }); await page.locator('.feed-card').first().waitFor();
  await page.locator('#learning-feed').evaluate((e) => e.scrollIntoView({ block: 'start', behavior: 'instant' }));
  await page.screenshot({ path: path.join(root, 'docs/feed-personalized-desktop.png') });
  const cards = await page.locator('.feed-card').evaluateAll((items) => items.map((n) => ({ type: n.dataset.coverType, title: n.querySelector('strong').textContent, image: n.querySelector('img')?.getAttribute('src') })));
  assert.equal(new Set(cards.map((p) => p.title)).size, cards.length);
  const photos = cards.filter((p) => p.type === 'photo'); assert.equal(new Set(photos.map((p) => p.image)).size, photos.length);
  await page.locator('.feed-card[data-cover-type="photo"] .feed-card-cover').first().click(); await page.getByRole('dialog').waitFor();
  await page.getByRole('link', { name: /摄影来源/ }).waitFor();
  await page.screenshot({ path: path.join(root, 'docs/feed-personalized-reader.png') });
  await page.getByRole('button', { name: '关闭推文' }).click();
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#learning-feed').evaluate((e) => e.scrollIntoView({ block: 'start', behavior: 'instant' }));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(root, 'docs/feed-personalized-mobile.png') });
  assert.deepEqual(errors, []); console.log(JSON.stringify({ cards: cards.length, photos: photos.length, text: cards.length - photos.length, uniqueTitles: cards.length, uniqueImages: photos.length, pageErrors: errors, analyticsSuppressed: true }));
} finally { await browser.close(); }
