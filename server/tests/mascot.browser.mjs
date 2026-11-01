// Real WebGL, mouse, keyboard and touch integration; isolated data, no paid APIs.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fixture } from './learning-feed.fixture.mjs';
import { createLearningFeedRouter } from '../src/services/learning-feed.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), f = fixture(), app = express();
app.use(express.json());
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/api/listening/schedule', (req, res) => res.json(f.schedule));
app.get('/api/personas', (req, res) => res.json({ ok: true, personas: [] }));
app.get('/api/qa/scopes', (req, res) => res.json({ teachers: [], stats: { ready: 0, totalWan: 0, teachers: 0, lectures: 0 } }));
app.get('/api/qa/sessions', (req, res) => res.json({ sessions: [] }));
app.use('/api/learning-feed', createLearningFeedRouter(f.service));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not used in the isolated mascot fixture' }));
app.use(express.static(path.join(root, 'web/dist'))); app.get('*', (req, res) => res.sendFile(path.join(root, 'web/dist/index.html')));
const server = await new Promise((resolve) => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
const base = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ headless: true }), errors = [];
const ready = async (page) => {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('.mascot-3d')?.dataset.status === 'ready');
  await page.waitForFunction(() => document.querySelector('.mascot-3d')?.dataset.engraving === 'made by 闵交幼儿园');
};
const atHome = (page) => page.waitForFunction(() => {
  const value = document.querySelector('.mascot-3d')?.dataset.rotation?.split(',').map(Number);
  return value && Math.abs(value[0] + .38) < .003 && Math.abs(value[1] - .08) < .003;
});
const clickPlanet = async (page, name) => {
  const planet = page.getByRole('button', { name, exact: true }), bounds = await planet.boundingBox();
  // A person first points at a moving planet; hovering stops its revolution.
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await planet.click();
};
try {
  const page = await browser.newPage({ viewport: { width: 849, height: 1004 } }); page.on('pageerror', (e) => errors.push(e.message));
  await ready(page); const ghost = page.locator('.mascot-3d');
  assert.equal(await ghost.locator('canvas').count(), 1);
  assert.equal(await ghost.locator('img').count(), 0);
  assert.equal(await page.locator('.mascot-satellite').count(), 6);
  assert.equal(await page.evaluate(() => document.fonts.check('36px "Synkore Pixel"', '闵交幼儿园')), true);
  await page.getByRole('button', { name: '暂停卡通动画', exact: true }).click();
  await ghost.screenshot({ path: path.join(root, 'docs/ghost-3d-front-close.png') });
  const box = await ghost.boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 175, y + 12, { steps: 14 });
  assert.equal(await ghost.evaluate((e) => e.hasPointerCapture(1)), true, 'Drag continues outside the character bounds');
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('.mascot-3d')?.dataset.facing === 'back');
  assert.equal(await ghost.evaluate((e) => e.hasPointerCapture(1)), false);
  await page.waitForTimeout(200); const pausedPose = await ghost.getAttribute('data-rotation');
  const satellite = page.locator('.mascot-satellite').first(), pausedMoon = await satellite.evaluate((e) => getComputedStyle(e).offsetDistance);
  await page.waitForTimeout(220);
  assert.equal(await ghost.getAttribute('data-rotation'), pausedPose);
  assert.equal(await satellite.evaluate((e) => getComputedStyle(e).offsetDistance), pausedMoon);
  await ghost.screenshot({ path: path.join(root, 'docs/ghost-3d-back-close.png') });
  await ghost.focus(); await page.keyboard.press('Home'); await atHome(page);
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('.mascot-3d')?.dataset.facing === 'back');
  for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(300);
  assert.ok(Math.abs(Number((await ghost.getAttribute('data-rotation')).split(',')[1])) <= .601);
  await ghost.dblclick(); await atHome(page);
  await page.getByRole('button', { name: '播放卡通动画', exact: true }).click();
  const movingMoon = await satellite.evaluate((e) => getComputedStyle(e).offsetDistance);
  await page.waitForTimeout(300); assert.notEqual(await satellite.evaluate((e) => getComputedStyle(e).offsetDistance), movingMoon);
  await clickPlanet(page, '个性化助手');
  assert.equal(await page.getByRole('textbox', { name: '课堂问题' }).isVisible(), true);
  assert.equal(new URL(page.url()).pathname, '/qa');
  await page.getByRole('link', { name: 'synkore·醒课 首页' }).click();
  await page.waitForFunction(() => document.querySelector('.mascot-3d')?.dataset.status === 'ready');
  await clickPlanet(page, '信息流学习'); assert.equal(new URL(page.url()).pathname, '/learning-feed');
  assert.equal(await page.locator('#hero-title,#listening-space,#agent-prompt').count(), 0);
  await page.getByRole('link', { name: 'synkore·醒课 首页' }).click();
  await page.waitForFunction(() => document.querySelector('.mascot-3d')?.dataset.status === 'ready');
  await ghost.locator('canvas').evaluate((canvas) => canvas.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
  await ghost.locator('img').waitFor(); assert.equal(await ghost.getAttribute('data-status'), 'fallback');

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); mobile.on('pageerror', (e) => errors.push(e.message));
  await ready(mobile); const mobileGhost = mobile.locator('.mascot-3d'), mobileBox = await mobileGhost.boundingBox();
  const touch = await mobile.context().newCDPSession(mobile), tx = Math.round(mobileBox.x + mobileBox.width * .3), ty = Math.round(mobileBox.y + mobileBox.height / 2);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tx, y: ty, id: 0 }] });
  for (let i = 1; i <= 11; i++) { await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: tx + i * 15, y: ty, id: 0 }] }); await mobile.waitForTimeout(12); }
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await mobile.waitForFunction(() => document.querySelector('.mascot-3d')?.dataset.facing === 'back');
  assert.equal(await mobileGhost.evaluate((e) => e.classList.contains('is-dragging')), false);
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await mobile.screenshot({ path: path.join(root, 'docs/ghost-3d-mobile.png') });

  const reduced = await browser.newPage({ viewport: { width: 849, height: 1004 }, reducedMotion: 'reduce' }); await ready(reduced);
  assert.equal(await reduced.locator('.learning-mascot').getAttribute('data-motion'), 'paused');
  const still = await reduced.locator('.mascot-3d').getAttribute('data-rotation'); await reduced.waitForTimeout(250);
  assert.equal(await reduced.locator('.mascot-3d').getAttribute('data-rotation'), still);
  await reduced.locator('.mascot-3d').focus(); await reduced.keyboard.press('ArrowRight');
  await reduced.waitForFunction(() => Number(document.querySelector('.mascot-3d')?.dataset.rotation.split(',')[0]) > -.2);

  const fallback = await browser.newPage();
  await fallback.addInitScript(() => { const original = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (name, ...args) { return /webgl/i.test(name) ? null : original.call(this, name, ...args); }; });
  await fallback.goto(base, { waitUntil: 'networkidle' });
  await fallback.locator('.mascot-3d[data-status="fallback"] img').waitFor();
  assert.equal(await fallback.locator('.mascot-rotate-hint').count(), 0);
  await clickPlanet(fallback, '个性化助手');
  assert.equal(await fallback.getByRole('textbox', { name: '课堂问题' }).isVisible(), true);
  assert.deepEqual(errors, []); assert.equal(f.calls.length, 0);
  console.log('PASS: real 3D front/back, pixel engraving, captured mouse drag, touch rotation, keyboard/reset, pause/reduced motion, satellite motion, planet entries, WebGL loss and fallback. No paid calls or user data touched.');
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); f.db.close(); }
