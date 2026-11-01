from __future__ import annotations

import json
import re
import shutil
import wave
from pathlib import Path

from .config import COURSES_DIR
from .db import connection, utc_now

SAFE_ID = re.compile(r"^[A-Za-z0-9_.-]+$")


def audio_duration_ms(path: Path) -> int:
    if path.suffix.lower() == ".wav":
        try:
            with wave.open(str(path), "rb") as audio:
                return round(audio.getnframes() / audio.getframerate() * 1000)
        except (wave.Error, ZeroDivisionError):
            return 0
    if path.suffix.lower() == ".pcm":
        return round(path.stat().st_size / 32)
    return 0


def import_course_package(source_dir: Path, course_id: str) -> dict:
    if not SAFE_ID.fullmatch(course_id):
        raise ValueError("课程 ID 只能包含字母、数字、点、下划线和连字符")
    source_dir = source_dir.resolve()
    audio = source_dir / "audio.wav"
    if not audio.exists():
        audio = source_dir / "audio.pcm"
    marks_path = source_dir / "marks.json"
    if not audio.exists() or not marks_path.exists():
        raise ValueError("课程包必须包含 audio.wav（或 audio.pcm）和 marks.json")
    raw_marks = json.loads(marks_path.read_text(encoding="utf-8"))
    marks = raw_marks.get("marks", raw_marks) if isinstance(raw_marks, dict) else raw_marks
    if not isinstance(marks, list):
        raise ValueError("marks.json 格式错误")
    meta_path = source_dir / "meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    target = COURSES_DIR / course_id
    target.mkdir(parents=True, exist_ok=True)
    for name in ("audio.wav", "audio.pcm", "marks.json", "meta.json", "transcript.json"):
        source = source_dir / name
        if source.exists() and source.parent != target:
            shutil.copy2(source, target / name)
    stored_audio = target / audio.name
    with connection() as db:
        db.execute("DELETE FROM courses WHERE id = ?", (course_id,))
        db.execute("""
            INSERT INTO courses(id, title, document_name, audio_path, audio_duration_ms, transcript_status, created_at)
            VALUES (?, ?, ?, ?, ?, 'pending', ?)
        """, (course_id, meta.get("title", course_id), meta.get("document_name", ""),
              str(stored_audio), audio_duration_ms(stored_audio), utc_now()))
        for mark in marks:
            time_ms = int(mark["time_ms"])
            if time_ms < 0:
                raise ValueError("标记时间不能为负数")
            db.execute("INSERT INTO marks(course_id, time_ms, kind) VALUES (?, ?, ?)",
                       (course_id, time_ms, mark.get("type", "confused")))
    transcript = target / "transcript.json"
    if transcript.exists():
        from .pipeline import save_transcript
        save_transcript(course_id, json.loads(transcript.read_text(encoding="utf-8")))
    return {"ok": True, "course_id": course_id, "mark_count": len(marks),
            "audio_duration_ms": audio_duration_ms(stored_audio)}
