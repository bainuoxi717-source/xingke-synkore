// 数据层：基于 Node 内置 SQLite（node:sqlite，Node 22+），零原生依赖
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 数据目录：<app>/data（数据库 + 上传文件）
export const DATA_DIR = path.resolve(__dirname, '../../data');
export const FILES_DIR = path.join(DATA_DIR, 'files');
fs.mkdirSync(FILES_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'workbench.db'));
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT DEFAULT '',
  name TEXT NOT NULL,
  teacher TEXT DEFAULT '',
  room TEXT DEFAULT '',
  color TEXT DEFAULT '#6366f1',
  credits REAL DEFAULT 0,
  category TEXT DEFAULT '',
  term TEXT DEFAULT '',
  canvas_id TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS schedule_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL,
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  weeks TEXT DEFAULT '',
  week_parity INTEGER DEFAULT 0,
  location TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  type TEXT DEFAULT '作业',
  due_at TEXT,
  description TEXT DEFAULT '',
  points REAL DEFAULT 0,
  status TEXT DEFAULT 'todo',
  source TEXT DEFAULT 'manual',
  external_id TEXT DEFAULT '',
  external_url TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT DEFAULT '',
  tags TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS grades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
  term TEXT DEFAULT '',
  score REAL,
  credit REAL,
  note TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS training_plan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  major TEXT DEFAULT '',
  degree TEXT DEFAULT '',
  total_credits REAL DEFAULT 0,
  raw TEXT DEFAULT '',
  parsed TEXT DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS study_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  items TEXT DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS review_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
  front TEXT NOT NULL,
  back TEXT DEFAULT '',
  source TEXT DEFAULT '',
  due_at TEXT,
  interval_days REAL DEFAULT 0,
  ease REAL DEFAULT 2.5,
  reps INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  file_path TEXT DEFAULT '',
  transcript TEXT DEFAULT '',
  summary TEXT DEFAULT '',
  quiz TEXT DEFAULT '',
  status TEXT DEFAULT 'uploaded',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  message TEXT NOT NULL,
  source TEXT DEFAULT '',
  read INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
  canvas_file_id TEXT DEFAULT '',
  name TEXT NOT NULL,
  content_type TEXT DEFAULT '',
  size INTEGER DEFAULT 0,
  folder TEXT DEFAULT '',
  source TEXT DEFAULT 'canvas',
  canvas_url TEXT DEFAULT '',
  local_path TEXT DEFAULT '',
  downloaded INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  kind TEXT DEFAULT 'web',
  enabled INTEGER DEFAULT 1,
  last_fetched TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS feed_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER REFERENCES sources(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT DEFAULT '',
  summary TEXT DEFAULT '',
  content TEXT DEFAULT '',
  published_at TEXT DEFAULT '',
  fetched_at TEXT NOT NULL,
  ai_score INTEGER,
  ai_tags TEXT DEFAULT '',
  ai_digest TEXT DEFAULT '',
  starred INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
  canvas_id TEXT DEFAULT '',
  title TEXT NOT NULL,
  message TEXT DEFAULT '',
  author TEXT DEFAULT '',
  posted_at TEXT DEFAULT '',
  url TEXT DEFAULT '',
  read_state TEXT DEFAULT 'unread',
  local_read INTEGER DEFAULT 0,
  fetched_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_state (
  domain TEXT PRIMARY KEY,
  last_run TEXT DEFAULT '',
  last_ok TEXT DEFAULT '',
  status TEXT DEFAULT 'idle',
  message TEXT DEFAULT ''
);
-- 登录态健康度：学习各系统会话寿命，提前预测过期
CREATE TABLE IF NOT EXISTS session_health (
  domain TEXT PRIMARY KEY,
  session_start TEXT DEFAULT '',
  last_ok TEXT DEFAULT '',
  last_fail TEXT DEFAULT '',
  fail_count INTEGER DEFAULT 0,
  ok_count INTEGER DEFAULT 0,
  lifetimes TEXT DEFAULT '[]',
  avg_lifetime_min INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT ''
);
-- 学习问答 · 对话存档（会话 + 消息）
CREATE TABLE IF NOT EXISTS qa_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT DEFAULT '',
  teacher TEXT DEFAULT '',
  subj_name TEXT DEFAULT '',
  mode TEXT DEFAULT 'teacher',
  pinned INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS qa_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES qa_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT DEFAULT '',
  meta TEXT DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS lectures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cour_id INTEGER NOT NULL UNIQUE,          -- 视频空间课次 id
  tecl_id INTEGER,                          -- 教学班 id
  course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  subj_code TEXT DEFAULT '',
  subj_name TEXT DEFAULT '',
  teacher TEXT DEFAULT '',
  week_no INTEGER,
  leti_number INTEGER,                       -- 第几节
  room TEXT DEFAULT '',
  begin_time TEXT DEFAULT '',                -- 2026-09-29 14:50:20
  end_time TEXT DEFAULT '',
  duration_sec INTEGER DEFAULT 0,
  shot_url TEXT DEFAULT '',                  -- 封面
  video_url TEXT DEFAULT '',                 -- mp4 直链（含 key，有时效）
  transcript TEXT DEFAULT '',                -- 字幕全文
  transcript_json TEXT DEFAULT '',           -- 带时间轴的字幕
  speakers TEXT DEFAULT '',                  -- 对应字幕片段的讲者标签；空值表示尚未识别
  summary_json TEXT DEFAULT '',              -- AI 思维导图/总结
  ppt_json TEXT DEFAULT '',                  -- PPT 切片 + OCR
  watched_percent REAL DEFAULT 0,
  fetched_at TEXT DEFAULT '',
  distilled_at TEXT DEFAULT '',
  note TEXT DEFAULT ''
);
`);

// Older development packages did not ship speaker labels. Keep their content,
// while making the QA and persona queries compatible without inventing speakers.
if (!db.prepare('PRAGMA table_info(lectures)').all().some((column) => column.name === 'speakers')) {
  db.exec("ALTER TABLE lectures ADD COLUMN speakers TEXT DEFAULT ''");
}

// 学习计划按日期唯一（用于 upsert）
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_study_plans_date ON study_plans(date);');
// 同一课程下同名 Canvas 文件唯一（同步时按此 upsert）
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_materials_canvas
         ON materials(course_id, canvas_file_id) WHERE canvas_file_id != '';`);
// 信息条目按 URL 去重
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_feed_url ON feed_items(url) WHERE url != '';`);
// Canvas 公告按 canvas_id 去重
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ann_canvas ON announcements(canvas_id) WHERE canvas_id != '';`);

// 便捷查询助手
export const q = (sql, ...params) => db.prepare(sql).all(...params);
export const q1 = (sql, ...params) => db.prepare(sql).get(...params) ?? null;
export const run = (sql, ...params) => db.prepare(sql).run(...params);
export const nowISO = () => new Date().toISOString();

export function getSettings() {
  const rows = q('SELECT key, value FROM settings');
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export function setSettings(patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === '') {
      run('DELETE FROM settings WHERE key = ?', k);
    } else {
      run(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        k, String(v)
      );
    }
  }
  return getSettings();
}
