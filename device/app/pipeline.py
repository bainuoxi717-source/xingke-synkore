from __future__ import annotations

import json
import math
import re
import uuid
from pathlib import Path

from .asr import marked_context, transcribe_audio
from .config import COURSES_DIR
from .db import connection
from .embeddings import cosine_similarity, embed_texts, embeddings_available


def save_transcript(course_id: str, segments: list[dict]) -> None:
    cleaned = []
    for segment in segments:
        start, end, text = int(segment["start_ms"]), int(segment["end_ms"]), str(segment["text"]).strip()
        if 0 <= start <= end and text:
            cleaned.append((course_id, start, end, text))
    if not cleaned:
        raise ValueError("语音识别没有产生有效文本")
    with connection() as db:
        db.execute("DELETE FROM transcripts WHERE course_id = ?", (course_id,))
        db.executemany("INSERT INTO transcripts(course_id, start_ms, end_ms, text) VALUES (?, ?, ?, ?)", cleaned)
        db.execute("UPDATE courses SET transcript_status = 'ready' WHERE id = ?", (course_id,))
        marks = db.execute("SELECT id, time_ms FROM marks WHERE course_id = ?", (course_id,)).fetchall()
        for mark in marks:
            context = marked_context([{"start_ms": s[1], "end_ms": s[2], "text": s[3]} for s in cleaned], mark["time_ms"])
            db.execute("UPDATE marks SET transcript_excerpt = ? WHERE id = ?", (context, mark["id"]))


def transcribe_course(course_id: str) -> int:
    with connection() as db:
        course = db.execute("SELECT audio_path FROM courses WHERE id = ?", (course_id,)).fetchone()
    if not course or not course["audio_path"]:
        raise ValueError("课程录音不存在")
    segments = transcribe_audio(Path(course["audio_path"]))
    save_transcript(course_id, segments)
    return len(segments)


def index_document(course_id: str, source_name: str, chunks: list[dict]) -> int:
    with connection() as db:
        if not db.execute("SELECT 1 FROM courses WHERE id = ?", (course_id,)).fetchone():
            raise ValueError("课程不存在")
        db.execute("DELETE FROM chunks WHERE course_id = ?", (course_id,))
        db.execute("UPDATE courses SET document_name = ? WHERE id = ?", (source_name, course_id))
        embeddings = embed_texts([chunk["content"] for chunk in chunks]) if embeddings_available() and chunks else []
        for index, chunk in enumerate(chunks):
            vector_json = json.dumps(embeddings[index]) if embeddings else None
            db.execute("INSERT INTO chunks(id, course_id, source_name, page, content, embedding_json) VALUES (?, ?, ?, ?, ?, ?)",
                       (uuid.uuid4().hex, course_id, source_name, chunk["page"], chunk["content"], vector_json))
    return len(chunks)


def _terms(text: str) -> set[str]:
    normalized = re.sub(r"\s+", "", text.lower())
    latin = set(re.findall(r"[a-z0-9_]+", text.lower()))
    chinese_bigrams = {normalized[i:i+2] for i in range(max(0, len(normalized)-1))}
    return latin | chinese_bigrams


def retrieve_chunks(course_id: str, query: str, limit: int = 3) -> list[dict]:
    with connection() as db:
        rows = db.execute("SELECT * FROM chunks WHERE course_id = ?", (course_id,)).fetchall()
    if embeddings_available() and rows and all(row["embedding_json"] for row in rows):
        query_vector = embed_texts([query])[0]
        ranked = [(cosine_similarity(query_vector, json.loads(row["embedding_json"])), dict(row)) for row in rows]
        return [row for score, row in sorted(ranked, key=lambda item: item[0], reverse=True)[:limit] if score > 0]
    query_terms = _terms(query)
    if not query_terms:
        return []
    ranked = []
    for row in rows:
        terms = _terms(row["content"])
        score = len(query_terms & terms) / math.sqrt(max(1, len(terms)))
        if score:
            ranked.append((score, dict(row)))
    return [row for _, row in sorted(ranked, key=lambda item: item[0], reverse=True)[:limit]]
