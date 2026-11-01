from __future__ import annotations

from pathlib import Path

import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .config import COURSES_DIR, SERIAL_PORT, STATIC_DIR
from .course_import import import_course_package
from .db import connection, get_feed, init_db, list_courses, set_feedback
from .demo import seed_demo
from .generator import generate_course_posts
from .parsers import chunk_pages, extract_document
from .pipeline import index_document, transcribe_course
from .serial_import import receive_course

app = FastAPI(title="知流", version="0.1.0")
init_db()


class FeedbackRequest(BaseModel):
    post_id: str
    status: str


class SerialImportRequest(BaseModel):
    course_id: str
    port: str = SERIAL_PORT


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "service": "zhiliu", "version": "0.1.0", "serial_port": SERIAL_PORT}


@app.get("/api/courses")
def courses() -> list[dict]:
    return list_courses()


@app.post("/api/demo/seed")
def demo() -> dict:
    return {"ok": True, "course_id": seed_demo()}


@app.post("/api/import/serial")
def serial_import(request: SerialImportRequest) -> dict:
    try:
        received = receive_course(request.course_id, port=request.port)
        result = import_course_package(Path(received["directory"]), request.course_id)
        return {**result, "port": request.port, "files": received["files"]}
    except (ValueError, TimeoutError, OSError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/courses/{course_id}/document")
async def upload_document(course_id: str, upload: UploadFile = File(...)) -> dict:
    filename = Path(upload.filename or "document").name
    suffix = Path(filename).suffix.lower()
    if suffix not in {".pdf", ".pptx", ".txt", ".md"}:
        raise HTTPException(status_code=422, detail="请上传 PDF、PPTX、TXT 或 Markdown 文件")
    course_dir = COURSES_DIR / course_id
    if not course_dir.exists():
        raise HTTPException(status_code=404, detail="请先导入课程录音")
    content = await upload.read(100 * 1024**2 + 1)
    if len(content) > 100 * 1024**2:
        raise HTTPException(status_code=413, detail="课件不能超过 100MB")
    path = course_dir / filename
    path.write_bytes(content)
    try:
        pages = extract_document(path)
        chunks = chunk_pages(pages)
        count = index_document(course_id, filename, chunks)
    except (ValueError, OSError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not count:
        raise HTTPException(status_code=422, detail="没有从课件中提取到文字；扫描版 PDF 需要先做 OCR")
    return {"ok": True, "course_id": course_id, "chunk_count": count}


@app.post("/api/courses/{course_id}/transcribe")
def transcribe(course_id: str) -> dict:
    try:
        count = transcribe_course(course_id)
        return {"ok": True, "course_id": course_id, "segment_count": count}
    except (ValueError, RuntimeError, OSError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/courses/{course_id}/generate")
def generate(course_id: str) -> dict:
    try:
        return generate_course_posts(course_id)
    except (ValueError, RuntimeError, OSError, httpx.HTTPError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/api/courses/{course_id}/marks")
def marks(course_id: str) -> list[dict]:
    with connection() as db:
        rows = db.execute("SELECT * FROM marks WHERE course_id = ? ORDER BY time_ms", (course_id,)).fetchall()
    return [dict(row) for row in rows]


@app.get("/api/feed")
def feed(course_id: str) -> list[dict]:
    return get_feed(course_id)


@app.post("/api/feedback")
def feedback(request: FeedbackRequest) -> dict:
    try:
        found = set_feedback(request.post_id, request.status)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not found:
        raise HTTPException(status_code=404, detail="Post not found")
    return {"ok": True}


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
