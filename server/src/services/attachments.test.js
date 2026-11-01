import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import express from 'express';
import { createAttachmentsRouter, MAX_ATTACHMENT_BYTES, resolveAttachmentMetadata } from './attachments.js';

async function fixture(t, maxBytes = MAX_ATTACHMENT_BYTES) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-attachments-test-'));
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE materials (
    id INTEGER PRIMARY KEY, course_id INTEGER, name TEXT, content_type TEXT,
    size INTEGER, source TEXT, local_path TEXT, downloaded INTEGER,
    created_at TEXT, updated_at TEXT
  )`);
  const q1 = (sql, ...params) => db.prepare(sql).get(...params);
  const run = (sql, ...params) => db.prepare(sql).run(...params);
  const app = express();
  app.use('/api/attachments', createAttachmentsRouter({ filesDir: root, q1, run, nowISO: () => new Date().toISOString(), maxBytes }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, db, base, q1, run, upload: (name, body, contentType = 'application/octet-stream') => fetch(`${base}/api/attachments/upload?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'Content-Type': contentType }, body }) };
}

async function filesIn(root) {
  return fs.readdir(path.join(root, 'agent-attachments')).catch(() => []);
}

test('arbitrary files preserve bytes and names, use random storage, and remain downloads', async (t) => {
  const f = await fixture(t);
  const payload = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
  const response = await f.upload('中文资料.svg', payload, 'image/png');
  assert.equal(response.status, 201);
  const { attachment } = await response.json();
  assert.equal(attachment.name, '中文资料.svg');
  assert.equal(attachment.content_type, 'application/octet-stream');
  assert.equal(attachment.size, payload.length);
  assert.equal(attachment.preview_url, undefined);
  const stored = f.q1('SELECT * FROM materials WHERE id = ?', attachment.id);
  assert.equal(stored.source, 'agent-upload');
  assert.match(path.basename(stored.local_path), /^[a-f0-9-]{36}\.bin$/);
  assert.deepEqual(await fs.readFile(stored.local_path), payload);
  const download = await fetch(`${f.base}${attachment.url}?preview=1`);
  assert.equal(download.headers.get('content-type'), 'application/octet-stream');
  assert.match(download.headers.get('content-disposition'), /^attachment;/);
  assert.match(download.headers.get('content-disposition'), /filename\*=UTF-8''/);
  assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
  assert.match(download.headers.get('content-security-policy'), /sandbox/);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), payload);
  assert.equal((await fetch(`${f.base}/api/attachments/${attachment.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await filesIn(f.root)).length, 0);
});

test('PNG preview requires signature and supports safe byte ranges', async (t) => {
  const f = await fixture(t);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRQAAAABJRU5ErkJggg==', 'base64');
  const { attachment } = await (await f.upload('test.png', png)).json();
  assert.equal(attachment.content_type, 'image/png');
  assert.ok(attachment.preview_url);
  const preview = await fetch(`${f.base}${attachment.preview_url}`, { headers: { Range: 'bytes=0-7' } });
  assert.equal(preview.status, 206);
  assert.match(preview.headers.get('content-disposition'), /^inline;/);
  assert.equal(preview.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await preview.arrayBuffer()), png.subarray(0, 8));
  const spoof = await (await f.upload('pretend.png', '<html><script>alert(1)</script></html>', 'image/png')).json();
  assert.equal(spoof.attachment.preview_url, undefined);
  assert.equal(spoof.attachment.content_type, 'application/octet-stream');
});

test('invalid names and empty uploads never create records or files', async (t) => {
  const f = await fixture(t);
  for (const name of ['../x', '..\\x', 'x\r\nHeader: a', '.', '..', '', 'x'.repeat(256)]) {
    assert.equal((await f.upload(name, 'x')).status, 400, name);
  }
  assert.equal((await f.upload('empty.txt', Buffer.alloc(0))).status, 400);
  assert.equal(f.q1('SELECT COUNT(*) AS n FROM materials').n, 0);
  assert.deepEqual(await filesIn(f.root), []);
});

test('size cap rejects both declared and chunked oversized requests and removes partial files', async (t) => {
  const f = await fixture(t, 32);
  assert.equal((await f.upload('too-large.bin', Buffer.alloc(33))).status, 413);
  const status = await new Promise((resolve, reject) => {
    const req = http.request(`${f.base}/api/attachments/upload?name=chunked.bin`, { method: 'POST', headers: { 'Transfer-Encoding': 'chunked' } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.write(Buffer.alloc(16));
    req.end(Buffer.alloc(24));
  });
  assert.equal(status, 413);
  assert.equal(f.q1('SELECT COUNT(*) AS n FROM materials').n, 0);
  assert.deepEqual(await filesIn(f.root), []);
});

test('client disconnect deletes the partial upload without recording a material', async (t) => {
  const f = await fixture(t);
  const req = http.request(`${f.base}/api/attachments/upload?name=aborted.bin`, { method: 'POST', headers: { 'Content-Length': '4096' } });
  req.on('error', () => {});
  req.write(Buffer.alloc(128));
  for (let i = 0; i < 100 && !(await filesIn(f.root)).length; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal((await filesIn(f.root)).length, 1);
  req.destroy();
  for (let i = 0; i < 100 && (await filesIn(f.root)).length; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(await filesIn(f.root), []);
  assert.equal(f.q1('SELECT COUNT(*) AS n FROM materials').n, 0);
});

test('attachment endpoints cannot read or delete legacy materials or out-of-directory files', async (t) => {
  const f = await fixture(t);
  const outside = path.join(f.root, 'existing-user-file.txt');
  await fs.writeFile(outside, 'keep me');
  f.run('INSERT INTO materials (id, name, source, local_path) VALUES (?,?,?,?)', 1, 'old.txt', 'canvas', outside);
  f.run('INSERT INTO materials (id, name, source, local_path) VALUES (?,?,?,?)', 2, 'bad.txt', 'agent-upload', outside);
  for (const id of [1, 2, 'NaN', '1.1']) {
    assert.equal((await fetch(`${f.base}/api/attachments/${id}`)).status, 404);
    assert.equal((await fetch(`${f.base}/api/attachments/${id}/file`)).status, 404);
    assert.equal((await fetch(`${f.base}/api/attachments/${id}`, { method: 'DELETE' })).status, 404);
  }
  assert.equal(await fs.readFile(outside, 'utf8'), 'keep me');
  assert.equal(f.q1('SELECT COUNT(*) AS n FROM materials').n, 2);
});

test('conversation metadata resolves only real agent uploads, ignores forged fields, and deduplicates IDs', async (t) => {
  const f = await fixture(t);
  const { attachment } = await (await f.upload('真实附件.txt', 'hello')).json();
  const fakePath = path.join(f.root, 'legacy.pdf');
  f.run('INSERT INTO materials (id, name, source, local_path) VALUES (?,?,?,?)', 100, 'legacy.pdf', 'canvas', fakePath);
  f.run('INSERT INTO materials (id, name, source, local_path) VALUES (?,?,?,?)', 101, 'outside.txt', 'agent-upload', fakePath);
  const ids = [attachment.id, String(attachment.id), 99999, 100, 101, -1, 1.1, '1 OR 1=1', null,
    { id: attachment.id, name: 'forged.html', content_type: 'text/html', url: 'https://example.com' }];
  const resolved = resolveAttachmentMetadata(ids, { filesDir: f.root, q1: f.q1 });
  assert.deepEqual(resolved, [attachment]);
  assert.equal(resolved[0].name, '真实附件.txt');
  assert.equal(resolved[0].local_path, undefined);
  assert.deepEqual(resolveAttachmentMetadata(undefined, { filesDir: f.root, q1: f.q1 }), []);
  assert.deepEqual(resolveAttachmentMetadata({ id: attachment.id }, { filesDir: f.root, q1: f.q1 }), []);
});
