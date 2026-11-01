from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

from .config import DB_PATH

SCHEMA = """
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS courses (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    document_name TEXT NOT NULL DEFAULT '',
    audio_path TEXT NOT NULL DEFAULT '',
    audio_duration_ms INTEGER NOT NULL DEFAULT 0,
    transcript_status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS marks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    time_ms INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'confused',
    transcript_excerpt TEXT NOT NULL DEFAULT '',
    knowledge_point TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS transcripts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    text TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    source_name TEXT NOT NULL,
    page INTEGER,
    content TEXT NOT NULL,
    embedding_json TEXT
);
CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    source_excerpt TEXT NOT NULL DEFAULT '',
    source_page INTEGER,
    priority REAL NOT NULL DEFAULT 0,
    knowledge_point TEXT NOT NULL DEFAULT '',
    replies_json TEXT NOT NULL DEFAULT '[]',
    myth_json TEXT
);
CREATE TABLE IF NOT EXISTS feedback (
    post_id TEXT PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK(status IN ('mastered', 'confused')),
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_marks_course ON marks(course_id);
CREATE INDEX IF NOT EXISTS idx_transcripts_time ON transcripts(course_id, start_ms, end_ms);
CREATE INDEX IF NOT EXISTS idx_chunks_course ON chunks(course_id);
CREATE INDEX IF NOT EXISTS idx_posts_priority ON posts(course_id, priority DESC);
"""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def connection(path: Path = DB_PATH) -> Iterator[sqlite3.Connection]:
    db = sqlite3.connect(path, timeout=30)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    try:
        yield db
        db.commit()
    finally:
        db.close()


def init_db() -> None:
    with connection() as db:
        db.executescript(SCHEMA)
        columns = {row["name"] for row in db.execute("PRAGMA table_info(chunks)")}
        if "embedding_json" not in columns:
            db.execute("ALTER TABLE chunks ADD COLUMN embedding_json TEXT")


def list_courses() -> list[dict]:
    with connection() as db:
        rows = db.execute("""
            SELECT c.*, COUNT(m.id) AS mark_count
            FROM courses c LEFT JOIN marks m ON m.course_id = c.id
            GROUP BY c.id ORDER BY c.created_at DESC
        """).fetchall()
    return [dict(row) for row in rows]


def get_feed(course_id: str) -> list[dict]:
    with connection() as db:
        rows = db.execute("""
            SELECT p.*, f.status AS feedback
            FROM posts p LEFT JOIN feedback f ON f.post_id = p.id
            WHERE p.course_id = ? ORDER BY p.priority DESC, p.id
        """, (course_id,)).fetchall()
    result = []
    for row in rows:
        item = dict(row)
        item["replies"] = json.loads(item.pop("replies_json"))
        myth = item.pop("myth_json")
        item["myth"] = json.loads(myth) if myth else None
        result.append(item)
    return result


def set_feedback(post_id: str, status: str) -> bool:
    if status not in {"mastered", "confused"}:
        raise ValueError("Unsupported feedback status")
    with connection() as db:
        row = db.execute("""
            SELECT p.id, f.status AS previous_status FROM posts p
            LEFT JOIN feedback f ON f.post_id = p.id WHERE p.id = ?
        """, (post_id,)).fetchone()
        if not row:
            return False
        db.execute("""
            INSERT INTO feedback(post_id, status, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(post_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at
        """, (post_id, status, utc_now()))
        weights = {None: 0, "mastered": -6, "confused": 4}
        delta = weights[status] - weights[row["previous_status"]]
        db.execute("UPDATE posts SET priority = priority + ? WHERE id = ?", (delta, post_id))
    return True
