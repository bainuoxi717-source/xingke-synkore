/**
 * import-data.mjs —— 把 study-mode-data.json 导入本地数据库
 *
 * 用法：
 *   node scripts/import-data.mjs                      # 用 ../data/study-mode-data.json
 *   node scripts/import-data.mjs <路径>                # 用指定文件
 *   node scripts/import-data.mjs --force              # 覆盖已有数据（默认幂等 upsert）
 *
 * 设计：
 *   · 先 import ../src/db.js 让它建好全部表结构
 *   · 再按 JSON 里的 tables 逐表 INSERT OR REPLACE（自动读表字段，无需硬写列名）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '../..');

const args = process.argv.slice(2);
const force = args.includes('--force');
const fileArg = args.find((a) => !a.startsWith('--'));
const dataFile = fileArg
  ? path.resolve(fileArg)
  : path.join(PKG, 'data', 'study-mode-data.json');

if (!fs.existsSync(dataFile)) {
  console.error('❌ 找不到数据文件：' + dataFile);
  console.error('   请把 study-mode-data.json 放到 data/ 目录，或用参数指定路径');
  process.exit(1);
}

// 导入 db.js（它会在初始化时建表）
const dbModule = await import('../src/db.js');
const { dbPath, DATA_DIR } = dbModule;
const { DatabaseSync } = await import('node:sqlite');

// 有些表是「懒创建」的（音色 / 讲法画像 / 换讲法缓存），访问路由时才建 —— 这里先主动建好
try {
  const { ensureVoiceTable } = await import('../src/services/voice.js');
  ensureVoiceTable();
} catch (e) { console.warn('[导入] 音色表创建跳过：' + e.message.slice(0, 60)); }
try {
  const { ensureStyleTable, ensureCacheTable } = await import('../src/services/restyle.js');
  ensureStyleTable();
  ensureCacheTable();
} catch (e) { console.warn('[导入] 讲法/缓存表创建跳过：' + e.message.slice(0, 60)); }

console.log('[导入] 数据文件：' + dataFile);
console.log('[导入] 数据库：' + (dbPath ?? path.join(DATA_DIR, 'workbench.db')));

const pack = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
const tables = pack.tables ?? {};
const db = new DatabaseSync(dbPath ?? path.join(DATA_DIR, 'workbench.db'));

// 收集现有表字段
function columnsOf(t) {
  try { return db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name); }
  catch { return []; }
}

let totalRows = 0;
const report = [];
for (const [table, rows] of Object.entries(tables)) {
  if (!Array.isArray(rows) || rows.length === 0) { report.push([table, 0, '空']); continue; }
  const cols = columnsOf(table);
  if (!cols.length) { report.push([table, 0, '表不存在（跳过）']); continue; }

  // 只取两边都有的列
  const use = Object.keys(rows[0]).filter((k) => cols.includes(k));
  if (!use.length) { report.push([table, 0, '无匹配列']); continue; }

  const sql = `INSERT OR REPLACE INTO ${table} (${use.join(',')}) VALUES (${use.map(() => '?').join(',')})`;
  const stmt = db.prepare(sql);

  if (force) { try { db.prepare(`DELETE FROM ${table}`).run(); } catch { /* 忽略 */ } }

  let n = 0;
  db.exec('BEGIN');
  try {
    for (const r of rows) {
      stmt.run(...use.map((k) => (r[k] === undefined ? null : r[k])));
      n++;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    report.push([table, 0, '失败：' + e.message.slice(0, 60)]);
    continue;
  }
  totalRows += n;
  report.push([table, n, 'ok']);
}

// 设置项（不含任何 Key）
if (pack.settings && Object.keys(pack.settings).length) {
  const st = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(pack.settings)) st.run(k, String(v));
  report.push(['settings', Object.keys(pack.settings).length, 'ok']);
  totalRows += Object.keys(pack.settings).length;
}

console.log('\n表                行数   状态');
console.log('─'.repeat(46));
for (const [t, n, s] of report) {
  console.log(t.padEnd(18) + String(n).padStart(5) + '   ' + s);
}
console.log('─'.repeat(46));
console.log('合计 ' + totalRows + ' 行');

// 自检
try {
  const lec = db.prepare('SELECT COUNT(*) AS n, SUM(LENGTH(transcript)) AS c FROM lectures').get();
  const voice = db.prepare('SELECT COUNT(*) AS n FROM teacher_voices WHERE voice_id != \'\'').get();
  const style = db.prepare('SELECT COUNT(*) AS n FROM teacher_styles').get();
  console.log('\n✅ 自检：课次 ' + lec.n + ' 节 / ' + Math.round((lec.c ?? 0) / 10000) + ' 万字 · 音色 ' + voice.n + ' 位 · 讲法画像 ' + style.n + ' 位');
} catch (e) {
  console.log('\n⚠️ 自检失败：' + e.message);
}
