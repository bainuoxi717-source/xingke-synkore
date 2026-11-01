// 从本机浏览器一键导入 SJTU 登录态（Cookie）
// 原理：Chromium 系浏览器的 Cookies 是 SQLite；主密钥用 DPAPI 保护，可解；
//      每条 Cookie 值用 AES-256-GCM 加密（v10 前缀）。
// 限制：浏览器运行时该文件被独占锁定（EBUSY），必须先完全退出浏览器几秒。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const LOCAL = process.env.LOCALAPPDATA ?? '';
const BROWSERS = [
  { id: 'chrome', label: 'Google Chrome', root: path.join(LOCAL, 'Google', 'Chrome', 'User Data') },
  { id: 'edge', label: 'Microsoft Edge', root: path.join(LOCAL, 'Microsoft', 'Edge', 'User Data') },
];

// 域名 → 工作台字段
const HOST_FIELD = [
  { match: /(^|\.)i\.sjtu\.edu\.cn$/, key: 'cookie_i', name: '教务' },
  { match: /(^|\.)my\.sjtu\.edu\.cn$/, key: 'cookie_my', name: '交我办' },
  { match: /(^|\.)oc\.sjtu\.edu\.cn$/, key: 'cookie_oc', name: 'Canvas' },
  { match: /(^|\.)v\.sjtu\.edu\.cn$/, key: 'cookie_v', name: '视频空间' },
  { match: /libspace\.sjtu\.edu\.cn$/, key: 'cookie_lib', name: '图书馆' },
  { match: /(^|\.)elec\.sjtu\.edu\.cn$/, key: 'cookie_elec', name: '电费' },
  { match: /dektcjd\.sjtu\.edu\.cn$/, key: 'cookie_dekt', name: '第二课堂' },
];

function isBrowserRunning(id) {
  const exe = id === 'chrome' ? 'chrome.exe' : 'msedge.exe';
  const r = spawnSync('tasklist', ['/FI', `IMAGENAME eq ${exe}`, '/NH'], { encoding: 'utf8', windowsHide: true });
  return String(r.stdout ?? '').toLowerCase().includes(exe.toLowerCase());
}

export function listBrowserProfiles() {
  const out = [];
  for (const b of BROWSERS) {
    if (!fs.existsSync(b.root)) continue;
    let dirs = [];
    try { dirs = fs.readdirSync(b.root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { continue; }
    for (const d of dirs) {
      if (d !== 'Default' && !/^Profile \d+$/.test(d)) continue;
      const dbPath = path.join(b.root, d, 'Network', 'Cookies');
      if (!fs.existsSync(dbPath)) continue;
      out.push({
        id: `${b.id}:${d}`,
        browser: b.id,
        label: b.label,
        profile: d,
        root: b.root,
        dbPath,
        running: isBrowserRunning(b.id),
        sizeKB: Math.round(fs.statSync(dbPath).size / 1024),
      });
    }
  }
  return out;
}

// DPAPI 解密主密钥（交给 PowerShell 做，.NET 原生支持）
function dpapiKey(root) {
  const ls = path.join(root, 'Local State');
  if (!fs.existsSync(ls)) throw new Error('找不到 Local State 文件');
  const j = JSON.parse(fs.readFileSync(ls, 'utf8'));
  const enc = j?.os_crypt?.encrypted_key;
  if (!enc) {
    if (j?.os_crypt?.app_bound_encrypted_key) {
      throw new Error('该浏览器启用了 app-bound 加密（新版 Edge 默认），运行中的进程外无法解密。请改用 Chrome，或用「粘贴 cURL」方式。');
    }
    throw new Error('Local State 里没有 encrypted_key');
  }
  const keyFile = path.join(os.tmpdir(), `wb-ck-key-${Date.now()}.txt`);
  const ps = [
    'Add-Type -AssemblyName System.Security;',
    `$j = Get-Content '${ls.replace(/'/g, "''")}' -Raw -Encoding UTF8 | ConvertFrom-Json;`,
    `$enc = [Convert]::FromBase64String($j.os_crypt.encrypted_key);`,
    `$key = [System.Security.Cryptography.ProtectedData]::Unprotect($enc[5..($enc.Length-1)], $null, 'CurrentUser');`,
    `[IO.File]::WriteAllText('${keyFile.replace(/'/g, "''")}', [Convert]::ToBase64String($key), (New-Object System.Text.UTF8Encoding $false));`,
  ].join(' ');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true });
  if (!fs.existsSync(keyFile)) {
    throw new Error('主密钥解密失败：' + String(r.stderr ?? '').slice(0, 160));
  }
  const b64 = fs.readFileSync(keyFile, 'utf8').trim();
  try { fs.unlinkSync(keyFile); } catch { /* 忽略 */ }
  return Buffer.from(b64, 'base64');
}

function decryptValue(buf, key) {
  const b = Buffer.from(buf);
  const prefix = b.subarray(0, 3).toString();
  if (prefix === 'v20') throw new Error('APP_BOUND');
  if (prefix !== 'v10' && prefix !== 'v11') return null;
  const nonce = b.subarray(3, 15);
  const tag = b.subarray(b.length - 16);
  const data = b.subarray(15, b.length - 16);
  const d = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}

// 在指定浏览器里打开若干网址（用于引导用户在 Chrome 登录）
export function openUrlsInBrowser(urls, browserId = 'chrome') {
  const exe = findExe(browserId);
  if (!exe) return { ok: false, error: `没找到 ${browserId === 'chrome' ? 'Chrome' : 'Edge'}，请手动打开这些网址。` };
  try {
    const child = spawn(exe, urls, { detached: true, stdio: 'ignore' });
    child.on('error', () => { /* 忽略 */ });
    child.unref();
    return { ok: true, browser: browserId, urls, exe };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// 找出浏览器可执行文件的真实路径（优先从正在运行的进程拿，其次常见安装位置）
function findExe(id) {
  const exe = id === 'chrome' ? 'chrome.exe' : 'msedge.exe';
  try {
    const r = spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `(Get-Process ${exe.replace('.exe', '')} -ErrorAction SilentlyContinue | Select-Object -First 1).Path`,
    ], { encoding: 'utf8', windowsHide: true });
    const p = String(r.stdout ?? '').trim();
    if (p && fs.existsSync(p)) return p;
  } catch { /* 忽略 */ }
  const cands = id === 'chrome'
    ? [
        path.join(process.env['PROGRAMFILES'] ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env['PROGRAMFILES(X86)'] ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(LOCAL, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      ]
    : [
        path.join(process.env['PROGRAMFILES(X86)'] ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(process.env['PROGRAMFILES'] ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      ];
  return cands.find((p) => p && fs.existsSync(p)) ?? '';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 安全地启动（必须挂 error 处理器，否则 spawn 的 error 事件会打崩进程）
function launchDetached(exePath) {
  if (!exePath || !fs.existsSync(exePath)) return false;
  try {
    const child = spawn(exePath, [], { detached: true, stdio: 'ignore' });
    child.on('error', () => { /* 忽略启动失败 */ });
    child.unref();
    return true;
  } catch { return false; }
}

// 执行导入：返回 { fields: {cookie_i: '...'}, found: [...] }
// opts.closeBrowser = true 时，会先优雅关闭浏览器、导入后再重开
export async function importFromBrowser(profileId, opts = {}) {
  const profiles = listBrowserProfiles();
  const p = profileId ? profiles.find((x) => x.id === profileId) : profiles.find((x) => !x.running) ?? profiles[0];
  if (!p) throw new Error('没有找到可用的浏览器配置（需要 Chrome 或 Edge，且有过登录记录）');

  const exe = p.browser === 'chrome' ? 'chrome.exe' : 'msedge.exe';
  let relaunch = false;
  let exePath = '';
  if (p.running) {
    if (!opts.closeBrowser) {
      const err = new Error(`请先**完全退出 ${p.label}**（含后台进程），再点一次导入；或点「关闭浏览器并导入」。浏览器运行时它的 Cookie 数据库被独占锁定，无法读取。`);
      err.code = 'BROWSER_RUNNING';
      err.browser = p.label;
      throw err;
    }
    exePath = findExe(p.browser);          // 先记下可执行文件位置，关闭后才能重开
    relaunch = true;
    // 优雅关闭 → 等待 → 必要时强杀
    spawnSync('taskkill', ['/IM', exe], { windowsHide: true });
    for (let i = 0; i < 12; i++) { await sleep(700); if (!isBrowserRunning(p.browser)) break; }
    if (isBrowserRunning(p.browser)) {
      spawnSync('taskkill', ['/F', '/IM', exe], { windowsHide: true });
      for (let i = 0; i < 10; i++) { await sleep(500); if (!isBrowserRunning(p.browser)) break; }
    }
    if (isBrowserRunning(p.browser)) throw new Error(`${p.label} 未能完全退出，请手动关闭后重试`);
  }

  try {
    return doImport(p, relaunch);
  } finally {
    if (relaunch) launchDetached(exePath);   // 会恢复上次会话
  }
}

function doImport(p, wasRunning) {
  // 复制数据库（浏览器已退出，直接复制即可）
  const tmpDb = path.join(os.tmpdir(), `wb-ck-${Date.now()}.db`);
  fs.copyFileSync(p.dbPath, tmpDb);

  const key = dpapiKey(p.root);
  const db = new DatabaseSync(tmpDb, { readOnly: true });
  let rows = [];
  try {
    rows = db.prepare("SELECT host_key, name, encrypted_value, path FROM cookies WHERE host_key LIKE '%sjtu%'").all();
  } finally { db.close(); }
  try { fs.unlinkSync(tmpDb); } catch { /* 忽略 */ }

  // 解密 → 按域名分组
  const byHost = new Map();
  const hostNames = [];      // 诊断用：库里到底有哪些 sjtu 域名/字段
  const hostOnly = [];
  let appBound = 0;
  for (const r of rows) {
    let val = null;
    try { val = decryptValue(r.encrypted_value, key); } catch (e) { if (e.message === 'APP_BOUND') { appBound++; continue; } throw e; }
    const h = r.host_key.replace(/^\./, '');
    hostNames.push(`${h}:${r.name}${val ? '' : '(解密失败)'}`);
    if (!hostOnly.includes(h)) hostOnly.push(h);
    if (!val) continue;
    const host = r.host_key.replace(/^\./, '');
    if (!byHost.has(host)) byHost.set(host, []);
    byHost.get(host).push(`${r.name}=${val}`);
  }

  // 按「域名 → 字段」聚合（父域优先，保证顺序稳定）
  const fields = {};
  const found = [];
  for (const [host, pairs] of byHost) {
    const rule = HOST_FIELD.find((r) => r.match.test(host));
    if (!rule) continue;
    const str = pairs.join('; ');
    // 同一字段可能有多个 host（如 libspace 与 www.libspace），合并
    fields[rule.key] = fields[rule.key] ? `${fields[rule.key]}; ${str}` : str;
    found.push({ key: rule.key, name: rule.name, host, cookies: pairs.length, chars: str.length });
  }

  return {
    browser: p.label, profile: p.profile, totalSJTU: rows.length,
    appBoundSkipped: appBound,
    fields, found,
    hosts: hostOnly,
    cookieNames: hostNames.slice(0, 40),
    note: appBound > 0 ? `有 ${appBound} 条 Cookie 使用了新版 app-bound 加密，已跳过（可能影响登录态完整性）` : '',
  };
}
