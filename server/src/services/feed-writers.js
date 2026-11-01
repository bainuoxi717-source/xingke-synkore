import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { hashContent } from './learning-feed-core.js';

export const WRITER_VERSION = 'learning-writers-v1';
export const WRITER_DEFINITIONS = [
  { id: 'dbskill', label: '清楚讲透', name: 'dontbesilent · dbskill', description: '围绕一个冲突，把概念、理由和例子讲顺。', directory: 'dbskill' },
  { id: 'cheat-on-content', label: '观察与反转', name: '蜗牛学长 · cheat-on-content', description: '从一个细节切入，用不同条件检验观点。', directory: 'cheat-on-content' },
  { id: 'bigpeng-hot-gzh', label: '选题与悬念', name: 'BigPeng · bigpeng-hot-gzh', description: '从兴趣和悬念吸引阅读，再用材料回应标题。', directory: 'bigpeng-hot-gzh' },
];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../skills');
const digest = (data) => createHash('sha256').update(data).digest('hex');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const section = (text, start, end) => { const at = text.indexOf(start); if (at < 0) throw new Error(`Missing reviewed writing section: ${start}`); const until = end ? text.indexOf(end, at + start.length) : -1; return text.slice(at, until < 0 ? undefined : until).trim(); };

export function loadWriterCatalog(base = root) {
  return WRITER_DEFINITIONS.map((definition) => {
    const directory = path.join(base, definition.directory), source = JSON.parse(fs.readFileSync(path.join(directory, 'SOURCE.json'), 'utf8'));
    for (const file of source.files) {
      const target = path.resolve(directory, file.path);
      if (!target.startsWith(path.resolve(directory) + path.sep) || digest(fs.readFileSync(target)) !== file.sha256) throw new Error(`写作 Skill 来源校验失败：${definition.id}/${file.path}`);
    }
    const read = (file) => fs.readFileSync(path.join(directory, file), 'utf8');
    const adapter = read('ADAPTER.md'); let original;
    if (definition.id === 'dbskill') original = [section(read('dbs-script-flow/SKILL.md'), '## 核心原则', '## 检查流程'), section(read('dbs-title-cover-intro/references/writing-rules.md'), '## 先说清楚，再压缩', '## 用目标观众的日常说法')].join('\n\n');
    else if (definition.id === 'cheat-on-content') original = section(read('skills/cheat-seed/SKILL.md'), '#### ⚠️ 正文必须是段落版', '#### 格式：');
    else original = read('references/title-formulas.md');
    const rules = `${adapter}\n\n以下是已审读的原方法片段，仅按上述适配范围使用：\n${original}`;
    return { ...definition, url: source.url, license: source.license, sourceVersion: source.commit || source.retrievedAt, recipeHash: hashContent({ version: WRITER_VERSION, files: source.files, adapter, original }), rules };
  });
}
export function createFeedWriters({ catalog = loadWriterCatalog() } = {}) {
  const version = hashContent({ version: WRITER_VERSION, recipes: catalog.map((s) => [s.id, s.recipeHash]) });
  const info = (writer, selection) => ({ id: writer.id, label: writer.label, name: writer.name, description: writer.description, url: writer.url, license: writer.license, sourceVersion: writer.sourceVersion, recipeHash: writer.recipeHash, ...(selection ? { selection } : {}) });
  function resolve(spec) {
    const writer = catalog.find((s) => s.id === spec?.id);
    if (!writer || writer.recipeHash !== spec.recipeHash) throw fail('本次写作方法已更新，请重新确认成篇方案', 409);
    return writer;
  }
  function choose(post, requested = 'auto', learned = { enabled: true, values: [] }) {
    if (requested !== 'auto') { const found = catalog.find((s) => s.id === requested); if (!found) throw fail('没有这个创作方式'); return info(found, 'manual'); }
    const seed = `${post.id}:${post.sourceHash}:${post.interest}:${post.format}`, explore = parseInt(hashContent(seed).slice(0, 4), 16) % 5 === 0;
    const weight = (writer) => {
      if (explore) return 1;
      let value = 1;
      if (writer.id === 'dbskill') value += post.origin === 'unclear' ? 1 : post.format === 'analysis' ? .6 : .1;
      if (writer.id === 'cheat-on-content') value += post.format === 'rebuttal' ? 1 : post.topical ? .7 : .2;
      if (writer.id === 'bigpeng-hot-gzh') value += ['poem', 'lyrics'].includes(post.format) ? .8 : post.sceneKind === 'music' ? .4 : .2;
      const affinity = learned.enabled ? learned.values.find((s) => s.feature === 'writer' && s.value === writer.id)?.score || 0 : 0;
      return value * Math.exp(Math.max(-3, Math.min(3, affinity)) * .35);
    };
    // Deterministic weighted sampling: stable for an unchanged plan, with no quotas.
    const selected = catalog.map((writer) => ({ writer, race: -Math.log((parseInt(hashContent(`${seed}:${writer.id}`).slice(0, 8), 16) + 1) / 4294967297) / weight(writer) })).sort((a, b) => a.race - b.race)[0].writer;
    return info(selected, explore ? 'auto-explore' : 'auto-context');
  }
  return { version, choose, resolve, list: () => catalog.map((writer) => info(writer)) };
}
