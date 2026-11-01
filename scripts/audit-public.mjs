import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..');
let files;
try { files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter(Boolean); } catch {}
if (!files?.length) {
  const excluded = new Set(['node_modules', 'dist', '.git', '.venv', '__pycache__', 'data', 'state', 'evidence']);
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => excluded.has(e.name) ? [] : e.isDirectory() ? walk(path.join(dir, e.name)) : [path.relative(root, path.join(dir, e.name)).replaceAll('\\', '/')]);
  files = walk(root);
}
const findings = [];
for (const name of files) {
  if (/^(?:data\/|device\/data\/|replay-demo\/(?:state|evidence)\/)|(?:^|\/)\.env$|\.(?:db|sqlite)(?:-wal|-shm)?$|(?:^|\/)node_modules\//.test(name)) findings.push([name, 'private/runtime path']);
  const bytes = fs.readFileSync(path.join(root, name));
  if (bytes.length > 50 * 1024 * 1024) findings.push([name, 'oversized file']);
  if (!/\.(?:[cm]?js|jsx|py|json|md|ps1|ya?ml|html|css|ino|cpp|[ch]|cmd|bat|example|svg|txt)$/.test(name)) continue;
  const text = bytes.toString('utf8');
  if (/(?:gh[pousr]_[A-Za-z0-9_]{25,}|github_pat_[A-Za-z0-9_]{30,}|sk-(?:api-)?[A-Za-z0-9_-]{25,}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----)/.test(text)) findings.push([name, 'possible credential']);
  if (/C:[/\\]Users[/\\]\d{5,}|wxid_[a-z0-9]{12,}/.test(text)) findings.push([name, 'personal machine path']);
}
if (findings.length) { console.error(JSON.stringify({ ok: false, findings }, null, 2)); process.exit(1); }
console.log(JSON.stringify({ ok: true, checkedFiles: files.length, checks: ['private paths', 'credential patterns', 'runtime databases', 'file sizes'] }));
