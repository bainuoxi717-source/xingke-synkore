// User-run helper: restart only this folder's recorded Node process on port 3930.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const entry = path.join(root, 'server/src/index.js'), metadataPath = path.join(root, '.agent-server.json');
const readWindows = (command) => {
  const result = execFileSync('powershell.exe', ['-NoProfile', '-Command', '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); ' + command], { encoding: 'utf8', windowsHide: true }).trim();
  return result ? JSON.parse(result) : null;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let previous = null;
try {
  assert.ok(fs.existsSync(entry), '找不到本项目网站程序');
  const listeners = [].concat(readWindows('Get-NetTCPConnection -State Listen -LocalPort 3930 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | ConvertTo-Json -Compress') || []);
  if (listeners.length) {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8').replace(/^\uFEFF/, ''));
    assert.equal(metadata.port, 3930, '进程记录端口不一致，未停止任何程序');
    assert.ok(Number.isSafeInteger(metadata.pid) && metadata.pid > 0, '进程记录无效');
    previous = readWindows(`Get-CimInstance Win32_Process -Filter 'ProcessId=${metadata.pid}' | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress`);
    assert.ok(previous?.Name === 'node.exe' && listeners.every((id) => id === previous.ProcessId), '3930 端口属于其他程序，未停止任何程序');
    const escapedEntry = entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const expectedCommand = new RegExp('^\\s*(?:"[^"]+"|\\S+)\\s+(?:"' + escapedEntry + '"|' + escapedEntry + ')\\s*$', 'i');
    assert.ok(expectedCommand.test(previous.CommandLine || ''), '进程不属于本项目，未停止任何程序');
  }
  if (process.argv.includes('--check-only')) {
    console.log(JSON.stringify({ checked: true, project: root, port: 3930, pid: previous?.ProcessId || null, changed: false }));
    process.exit(0);
  }
  if (previous) {
    console.log('正在重启本项目网站…');
    process.kill(previous.ProcessId, 'SIGTERM');
    for (let i = 0; i < 30; i++) {
      try { process.kill(previous.ProcessId, 0); } catch { break; }
      await sleep(100);
    }
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const stdout = fs.openSync(path.join(root, 'docs', `site-restart-${stamp}.out.log`), 'a');
  const stderr = fs.openSync(path.join(root, 'docs', `site-restart-${stamp}.err.log`), 'a');
  const child = spawn(process.execPath, [entry], { cwd: root, env: { ...process.env, PORT: '3930' }, detached: true, windowsHide: true, stdio: ['ignore', stdout, stderr] });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref(); fs.closeSync(stdout); fs.closeSync(stderr);
  fs.writeFileSync(metadataPath, JSON.stringify({ pid: child.pid, port: 3930 }, null, 2));
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try {
      const response = await fetch('http://localhost:3930/api/health', { signal: AbortSignal.timeout(1000) });
      if (response.ok && (await response.json()).ok) { ready = true; break; }
    } catch {}
    await sleep(300);
  }
  assert.ok(ready, '网站未就绪，请把 docs 中本次 site-restart 日志发给 Codex');
  const config = await (await fetch('http://localhost:3930/api/custom-personas/config')).json();
  assert.ok(config.flowVersion >= 3, '网站未载入新版接口，请将提示发给 Codex');
  console.log('网站已更新，可以刷新网页：http://localhost:3930/');
} catch (error) { console.error(error.message); process.exitCode = 1; }
