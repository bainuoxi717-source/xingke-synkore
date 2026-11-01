// Isolated public-package smoke check. It never opens a serial port or calls AI.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const root = path.resolve(import.meta.dirname, '..');
const probe = net.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r));
const port = probe.address().port; await new Promise(r => probe.close(r));
const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1' };
delete env.DEEPSEEK_KEY; delete env.MINIMAX_KEY;
const child = spawn(process.execPath, ['scripts/start.mjs'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let logs = ''; child.stdout.on('data', b => logs += b); child.stderr.on('data', b => logs += b);
const base = `http://127.0.0.1:${port}`;
let browser;
try {
  let ready = false;
  for (let i=0; i<60; i++) {
    try { const r = await fetch(base + '/api/health'); if (r.ok) { ready = true; break; } } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  assert.ok(ready, 'Clean backend failed to start: ' + logs.slice(-2000));
  const settings = await fetch(base + '/api/settings').then(r => r.json());
  assert.ok(!settings.deepseekKey && !settings.minimaxKey && !settings.canvasCookie, 'Public smoke check requires a clean database');
  const lectures = await fetch(base + '/api/lectures').then(r => r.json());
  assert.equal((lectures.lectures || lectures).length, 2, 'Only the two authored public lessons should exist');
  browser = await chromium.launch({ headless: true, channel: process.env.SYNKORE_BROWSER_CHANNEL || 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1366, height: 1000 } });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // Intercept the real bridge address, so this check cannot touch another local session or device.
  const demo = JSON.parse(await fs.readFile(path.join(root, 'replay-demo/demo.json'), 'utf8'));
  await context.route('http://127.0.0.1:8771/**', async route => {
    const url = new URL(route.request().url());
    const headers = { 'Access-Control-Allow-Origin': base, 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (url.pathname === '/media') return route.fulfill({ path: path.join(root, 'replay-demo/media/research-methods-5min.mp4'), contentType: 'video/mp4', headers });
    const data = url.pathname === '/demo' ? { ...demo, mediaReady: true } : url.pathname === '/board' ? { connected: false, ports: [] } : url.pathname === '/marks' ? { marks: [] } : { ok: true, mediaReady: true, mode: 'prepared-replay' };
    return route.fulfill({ json: data, headers });
  });
  await fs.mkdir(path.join(root, 'docs/images'), { recursive: true });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByText('built for', { exact: false }).first().waitFor();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(root, 'docs/images/home.png'), fullPage: true });
  await page.goto(base + '/qa', { waitUntil: 'networkidle' });
  assert.ok((await page.getByLabel('选择课堂课次').innerText()).includes('公开示例'));
  await page.goto(base + '/replay-demo', { waitUntil: 'networkidle' });
  await page.getByText('公开示例课 · 预分析卡片', { exact: false }).waitFor();
  await page.locator('video').waitFor();
  assert.equal(await page.locator('video').evaluate(v => Math.round(v.duration)), 300);
  await page.screenshot({ path: path.join(root, 'docs/images/replay.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS: clean backend, two authored lessons, no configured credentials, home / QA / replay, 300-second sample video, no browser errors, no serial or model calls.');
} finally {
  await browser?.close();
  const closed = new Promise(resolve => child.once('exit', resolve));
  child.kill(); await closed;
}
