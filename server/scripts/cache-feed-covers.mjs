// Cache explicitly searched, licence-recorded photos. No model or paid search calls.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const input = JSON.parse(fs.readFileSync(path.join(root, 'server/skills/feed-covers/catalog.json'), 'utf8'));
const dir = path.join(root, 'web/public/assets/feed-covers'); fs.mkdirSync(dir, { recursive: true });
const assets = [], failures = [], hashes = new Set(); let cursor = 0;
async function next() {
  while (cursor < input.assets.length) {
    const item = input.assets[cursor++], destination = path.join(dir, `${item.id}.jpg`);
    try {
      let bytes;
      const originalURL = `https://images.pexels.com/photos/${item.photoId}/pexels-photo-${item.photoId}.jpeg?auto=compress&cs=tinysrgb&w=1000&q=82`;
      if (fs.existsSync(destination)) bytes = fs.readFileSync(destination);
      else {
        const response = await fetch(originalURL, { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Accept: 'image/jpeg' } });
        if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error(`HTTP ${response.status}`);
        bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > 3 * 1024 * 1024 || bytes[0] !== 255 || bytes[1] !== 216) throw new Error('Unexpected image format or size');
        fs.writeFileSync(destination, bytes);
      }
      const sha256 = createHash('sha256').update(bytes).digest('hex'); if (hashes.has(sha256)) { failures.push({ id: item.id, error: 'Duplicate image bytes' }); continue; }
      hashes.add(sha256); assets.push({ ...item, src: `/assets/feed-covers/${item.id}.jpg`, sha256, bytes: bytes.length, originalURL, type: 'searched', cachedAt: new Date().toISOString() });
    } catch (error) { failures.push({ id: item.id, error: error.message }); }
  }
}
await Promise.all([next(), next(), next()]); assets.sort((a, b) => a.id.localeCompare(b.id));
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ version: 1, searchedAt: input.searchedAt, assets, failures }, null, 2));
console.log(JSON.stringify({ cached: assets.length, byKind: assets.reduce((out, item) => (out[item.kind] = (out[item.kind] || 0) + 1, out), {}), failures }));
