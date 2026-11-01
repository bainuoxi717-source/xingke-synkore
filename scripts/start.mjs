import { getSettings, setSettings } from '../server/src/db.js';
// Environment values only fill missing local settings; never print credentials.
const current = getSettings(), patch = {};
for (const [variable, key] of [['DEEPSEEK_KEY', 'deepseekKey'], ['MINIMAX_KEY', 'minimaxKey']]) {
  if (process.env[variable] && !current[key]) patch[key] = process.env[variable];
}
if (Object.keys(patch).length) setSettings(patch);
await import('../server/src/index.js');
