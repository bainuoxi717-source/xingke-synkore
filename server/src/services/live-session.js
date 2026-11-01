// 工作台专用浏览器会话（根治登录态过期问题）
//
// 思路：不再「复制 Cookie 快照」（3 天就失效），而是让工作台拥有一个**专用 Chrome 窗口**。
//   - 专用配置目录（非默认配置 → 允许开调试端口）
//   - 用户在窗口里登录一次后，会话一直活着
//   - 工作台通过 CDP 让**浏览器自己**导出 Cookie（明文，绕过 app-bound 加密）
//   - 过期时工作台自动重新导出，无需用户操作
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const PORT = Number(process.env.WB_CDP_PORT || 9333);
const PROFILE = path.join(os.homedir(), '.sjtu-workbench', 'browser-profile');
const LOG = path.join(os.homedir(), '.sjtu-workbench', 'session.log');

function log(msg) {
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${msg}\n`);
  } catch { /* 忽略 */ }
}

export function findChrome() {
  const cands = [
    path.join(process.env['PROGRAMFILES'] ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ];
  return cands.find((p) => p && fs.existsSync(p)) ?? '';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdpAlive() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch { return false; }
}

// 启动专用浏览器（有窗口，用户能在里面登录）
export async function ensureBrowser({ openUrls = [] } = {}) {
  const exe = findChrome();
  if (!exe) throw new Error('没找到 Chrome，请先安装 Google Chrome');
  fs.mkdirSync(PROFILE, { recursive: true });

  if (!(await cdpAlive())) {
    log('启动专用浏览器会话');
    const args = [
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${PROFILE}`,
      '--no-first-run', '--no-default-browser-check', '--disable-features=Translate',
      '--new-window',
      ...(openUrls.length ? openUrls : ['about:blank']),
    ];
    const child = spawn(exe, args, { detached: true, stdio: 'ignore' });
    child.on('error', (e) => log('启动失败: ' + e.message));
    child.unref();
    for (let i = 0; i < 30; i++) { await sleep(700); if (await cdpAlive()) break; }
  } else if (openUrls.length) {
    // 已开着 → 新标签打开
    await openPages(openUrls);
  }
  if (!(await cdpAlive())) throw new Error('专用浏览器未能启动（调试端口未就绪）');
  return { ok: true, profile: PROFILE, port: PORT };
}

async function pickTarget() {
  let list = [];
  try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(3000) })).json(); } catch { return null; }
  return list.find((t) => t.type === 'page') ?? list[0] ?? null;
}

// 新建标签页（Chrome 新版要求 PUT）
export async function openPages(urls) {
  for (const u of urls) {
    try {
      await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(u)}`, { method: 'PUT', signal: AbortSignal.timeout(4000) });
    } catch {
      try { await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(u)}`, { signal: AbortSignal.timeout(4000) }); } catch { /* 忽略 */ }
    }
  }
}

function cdpSession(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pend = new Map();
    ws.onopen = () => resolve({
      send: (method, params = {}) => new Promise((res, rej) => {
        const i = ++id;
        pend.set(i, { res, rej });
        ws.send(JSON.stringify({ id: i, method, params }));
        setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error(method + ' 超时')); } }, 15000);
      }),
      close: () => { try { ws.close(); } catch { /* 忽略 */ } },
    });
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pend.has(m.id)) {
        const { res, rej } = pend.get(m.id);
        pend.delete(m.id);
        if (m.error) rej(new Error(m.error.message ?? 'CDP 错误')); else res(m.result);
      }
    };
    ws.onerror = () => reject(new Error('无法连接浏览器调试端口'));
  });
}

// 让浏览器导出**所有** Cookie（含 HttpOnly；由浏览器自己解密）
export async function readAllCookies() {
  const target = await pickTarget();
  if (!target) throw new Error('专用浏览器没有可用页面，请先打开一次');
  const s = await cdpSession(target.webSocketDebuggerUrl);
  try {
    await s.send('Network.enable');
    const r = await s.send('Network.getAllCookies');
    return r.cookies ?? [];
  } finally { s.close(); }
}

// 保持会话活跃：访问各站首页（避免因长时间无活动而失效）
export async function keepAlive(urls = []) {
  const target = await pickTarget();
  if (!target) return { ok: false, error: '浏览器未运行' };
  const s = await cdpSession(target.webSocketDebuggerUrl);
  const out = [];
  try {
    await s.send('Page.enable');
    await s.send('Network.enable');
    for (const u of urls) {
      try { await s.send('Page.navigate', { url: u }); out.push({ url: u, ok: true }); } catch (e) { out.push({ url: u, ok: false, error: e.message }); }
      await sleep(1200);
    }
  } finally { s.close(); }
  return { ok: true, visited: out };
}

// 各系统的 SSO 自动登录入口（jAccount 会话还活着时，访问它即可静默恢复登录态）
export const SSO_ENTRIES = [
  'https://i.sjtu.edu.cn/jaccountlogin',          // 教务：必须走这个入口，否则停在登录页
  'https://oc.sjtu.edu.cn/login/openid_connect',  // Canvas：同样必须走 SSO 入口，首页只会停在登录页
  'https://my.sjtu.edu.cn/',                      // 交我办：会自动跳 jAccount
];

// 静默恢复各系统登录态：依次访问 SSO 入口，让 jAccount 自动带过会话
export async function ensureSessions() {
  const target = await pickTarget();
  if (!target) return { ok: false, error: '专用浏览器未运行' };
  const s = await cdpSession(target.webSocketDebuggerUrl);
  const steps = [];
  try {
    await s.send('Page.enable');
    await s.send('Network.enable');
    for (const u of SSO_ENTRIES) {
      try {
        await s.send('Page.navigate', { url: u });
        await sleep(5000);
        const r = await s.send('Runtime.evaluate', { expression: 'location.href', returnByValue: true });
        const href = r?.result?.value ?? '';
        // 落在登录相关路径 = 没登录成功
        const loggedIn = !/login|jalogin|oauth|openid_connect|saml|sign_in/i.test(href);
        steps.push({ url: u, landed: href, ok: loggedIn });
      } catch (e) {
        steps.push({ url: u, ok: false, error: e.message });
      }
    }
    return { ok: true, steps };
  } finally { s.close(); }
}

export async function sessionStatus() {
  const alive = await cdpAlive();
  return { running: alive, port: PORT, profile: PROFILE, chrome: findChrome() ? '已安装' : '未找到', loginUrl: '' };
}

// 用户是否已在专用窗口里登录过（判断有无目标域名 Cookie）
export function summarizeHosts(cookies) {
  const hosts = {};
  for (const c of cookies) {
    const h = c.domain.replace(/^\./, '');
    if (!/sjtu\.edu\.cn$/.test(h)) continue;
    hosts[h] = hosts[h] ?? [];
    hosts[h].push(c.name);
  }
  return hosts;
}
