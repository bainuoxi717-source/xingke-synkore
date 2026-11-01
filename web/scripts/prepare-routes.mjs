import fs from 'node:fs';
import path from 'node:path';
const index = fs.readFileSync('dist/index.html');
for (const route of ['qa', 'assistant', 'replay-demo', 'learning-feed', 'restyle', 'settings', 'personas/custom']) {
  const folder = path.join('dist', route); fs.mkdirSync(folder, { recursive: true }); fs.writeFileSync(path.join(folder, 'index.html'), index);
}
