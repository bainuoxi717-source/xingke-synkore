"""Read completed TF-card courses without modifying the card or existing courses."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import shutil
import tempfile
import wave

from .config import COURSES_DIR, IMPORTS_DIR
from .course_import import import_course_package
from .db import connection

SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def file_sha256(path: Path) -> str:
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def discover_card_courses(path: Path) -> list[Path]:
    path = path.resolve()
    if (path / 'audio.wav').is_file() and (path / 'marks.json').is_file():
        return [path]
    folder = path / 'courses' if (path / 'courses').is_dir() else path
    if not folder.is_dir():
        return []
    return sorted((p for p in folder.iterdir() if p.is_dir() and
                   (p / 'audio.wav').is_file() and (p / 'marks.json').is_file()),
                  key=lambda p: p.name)


def import_card_course(source: Path) -> dict:
    source = source.resolve(strict=True)
    audio = source / 'audio.wav'
    marks_path = source / 'marks.json'
    if not audio.is_file() or not marks_path.is_file():
        raise ValueError('请选择包含 audio.wav 和 marks.json 的完整课程文件夹')
    if audio.stat().st_size > 256 * 1024**2 or marks_path.stat().st_size > 2 * 1024**2:
        raise ValueError('课程文件超过支持的大小')
    try:
        with wave.open(str(audio), 'rb') as w:
            if w.getcomptype() != 'NONE' or not 1 <= w.getnchannels() <= 2 or w.getnframes() == 0:
                raise ValueError('录音不是有效的 PCM WAV 文件')
            duration_ms = round(w.getnframes() * 1000 / w.getframerate())
        raw = json.loads(marks_path.read_text(encoding='utf-8-sig'))
        marks = raw.get('marks') if isinstance(raw, dict) else raw
        if not isinstance(marks, list) or len(marks) > 10000:
            raise ValueError('marks.json 格式错误')
        clean_marks = []
        for item in marks:
            t = item.get('time_ms') if isinstance(item, dict) else None
            if isinstance(t, bool) or not isinstance(t, int) or not 0 <= t <= duration_ms + 2000:
                raise ValueError('标记时间超出录音范围')
            kind = item.get('type', 'confused')
            if not isinstance(kind, str) or len(kind) > 32:
                raise ValueError('标记类型格式错误')
            clean_marks.append({'time_ms': t, 'type': kind})
        meta_path = source / 'meta.json'
        if meta_path.exists() and meta_path.stat().st_size > 1024**2:
            raise ValueError('meta.json 文件过大')
        meta = json.loads(meta_path.read_text(encoding='utf-8-sig')) if meta_path.exists() else {}
        if not isinstance(meta, dict):
            raise ValueError('meta.json 格式错误')
    except (wave.Error, EOFError, ZeroDivisionError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError('录音或课程信息损坏，请确认开发板已完成保存') from exc

    digest = file_sha256(audio)
    base = source.name if SAFE_ID.fullmatch(source.name) else 'card_' + digest[:12]
    course_id = base
    for attempt in range(2):
        with connection() as db:
            existing = db.execute('SELECT * FROM courses WHERE id=?', (course_id,)).fetchone()
            count = db.execute('SELECT COUNT(*) FROM marks WHERE course_id=?', (course_id,)).fetchone()[0]
        if existing is None:
            break
        stored = Path(existing['audio_path'])
        if stored.is_file() and file_sha256(stored) == digest:
            return {'ok': True, 'course_id': course_id, 'already_imported': True,
                    'mark_count': count, 'audio_duration_ms': existing['audio_duration_ms'],
                    'audio_sha256': digest}
        course_id = base[:48] + '_sd_' + digest[:12]
    else:
        raise ValueError('课程编号冲突，已有课程已保留')

    title = meta.get('title', base)
    if not isinstance(title, str):
        raise ValueError('课程标题格式错误')
    title = title[:160]
    if course_id != base:
        title += ' · TF ' + digest[:6]
    IMPORTS_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='card-', dir=IMPORTS_DIR) as folder:
        stage = Path(folder)
        shutil.copy2(audio, stage / 'audio.wav')
        if file_sha256(stage / 'audio.wav') != digest:
            raise ValueError('复制校验失败，请检查读卡器连接后重试')
        (stage / 'marks.json').write_text(json.dumps({'marks': clean_marks}, ensure_ascii=False), encoding='utf-8')
        (stage / 'meta.json').write_text(json.dumps({'title': title, 'audio_duration_ms': duration_ms}, ensure_ascii=False), encoding='utf-8')
        result = import_course_package(stage, course_id)
    if file_sha256(COURSES_DIR / course_id / 'audio.wav') != digest:
        raise OSError('本机录音复制校验失败')
    return {**result, 'already_imported': False, 'audio_sha256': digest}
