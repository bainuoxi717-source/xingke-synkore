import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createPersonaMedia } from '../src/services/custom-persona-media.js';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'synkore-media-unit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'agent-attachments'));
  const local = path.join(root, 'agent-attachments/audio.bin'); await fs.writeFile(local, 'fake audio');
  const row = { name: 'recording.wav', local_path: local };
  const media = createPersonaMedia({ filesDir: root, q1: () => row, python: path.join(root, 'missing-python.exe'), readSources: async () => [{ id: '1', name: row.name, text: '', status: 'unsupported' }] });
  return { root, row, local, media };
}
test('only uploaded media paths inside the attachment directory can enter local transcription', async (t) => {
  const f = await fixture(t);
  await assert.rejects(() => f.media.start('../1'), /编号无效/);
  f.row.name = 'file.txt'; await assert.rejects(() => f.media.start('1'), /音视频/);
  f.row.name = 'file.wav'; f.row.local_path = path.join(f.root, 'other.wav'); await fs.writeFile(f.row.local_path, 'outside');
  await assert.rejects(() => f.media.start('1'), /上传目录/);
});
test('cached local speech is read with explicit scope; a changed file invalidates it without launching a provider', async (t) => {
  const f = await fixture(t), stat = await fs.stat(f.local);
  await fs.mkdir(path.join(f.root, 'persona-transcripts'));
  await fs.writeFile(path.join(f.root, 'persona-transcripts/1.json'), JSON.stringify({ fingerprint: `${stat.size}:${stat.mtimeMs}`, text: '原始讲话'.repeat(5000), notice: '本机语音转写，可能有识别误差' }));
  assert.equal((await f.media.start('1')).state, 'ready');
  const source = (await f.media.read(['1']))[0]; assert.equal(source.text.length, 12000); assert.equal(source.status, 'partial'); assert.match(source.notice, /12000/);
  await fs.writeFile(f.local, 'changed'); assert.equal((await f.media.status('1')).state, 'idle');
  await assert.rejects(() => f.media.start('1'), /本机转写环境不可用/);
  assert.equal((await f.media.read(['1']))[0].text, '');
});
