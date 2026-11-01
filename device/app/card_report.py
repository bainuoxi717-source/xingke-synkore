"""Publish local card-import results through the existing static-file website."""
from __future__ import annotations
import html
from pathlib import Path
import shutil
from urllib.parse import quote
from .card_import import SAFE_ID, file_sha256
from .config import STATIC_DIR
from .db import connection


def publish_card_report(course_id: str) -> Path:
    if not SAFE_ID.fullmatch(course_id):
        raise ValueError('Invalid course id')
    with connection() as db:
        course = db.execute('SELECT * FROM courses WHERE id=?', (course_id,)).fetchone()
        segments = db.execute('SELECT start_ms,end_ms,text FROM transcripts WHERE course_id=? ORDER BY start_ms', (course_id,)).fetchall()
        marks = db.execute('SELECT COUNT(*) FROM marks WHERE course_id=?', (course_id,)).fetchone()[0]
    if course is None:
        raise ValueError('课程不存在')
    folder = STATIC_DIR / 'card_results'
    folder.mkdir(parents=True, exist_ok=True)
    stored = Path(course['audio_path'])
    playback = folder / (course_id + '.wav')
    if not playback.exists() or file_sha256(playback) != file_sha256(stored):
        shutil.copy2(stored, playback)
    def timestamp(ms):
        seconds = ms // 1000
        return f'{seconds // 60:02d}:{seconds % 60:02d}'
    plain = '\n'.join(f"[{timestamp(s['start_ms'])}] {s['text']}" for s in segments)
    (folder / (course_id + '.txt')).write_text(plain, encoding='utf-8')
    rows = ''.join(f'<div class="segment"><time>{timestamp(s["start_ms"])}</time><p>{html.escape(s["text"])}</p></div>' for s in segments)
    title = html.escape(course['title'])
    encoded = quote(course_id)
    page = f'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; media-src 'self' file:; img-src 'self'">
<title>{title} · 知流录音转写</title><style>
body{{margin:0;background:#f6f7f9;color:#17202c;font:16px/1.7 'Microsoft YaHei','Segoe UI',sans-serif}}main{{max-width:900px;margin:auto;padding:24px}}header{{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}}a{{color:#3157d5}}.card{{background:white;border:1px solid #e5e8ed;border-radius:18px;padding:24px;margin-top:20px}}h1{{font-size:26px;margin:10px 0}}.meta{{color:#6c7685}}audio{{width:100%;margin:14px 0}}.segment{{display:grid;grid-template-columns:64px 1fr;gap:16px;border-top:1px solid #edf0f4;padding:14px 0}}time{{color:#3157d5;font-size:14px}}p{{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}}@media(max-width:500px){{main{{padding:16px}}.card{{padding:18px}}.segment{{grid-template-columns:48px 1fr;gap:10px}}}}
</style><main><header><strong>知流 · 录音转写</strong><a href="../../?course={encoded}">返回学习信息流</a></header>
<section class="card"><span class="meta">TF 读卡器导入</span><h1>{title}</h1><p class="meta">{timestamp(course['audio_duration_ms'])} · {marks} 个不懂标记 · {len(segments)} 段文字</p>
<audio controls preload="metadata" src="{encoded}.wav"></audio><a href="{encoded}.txt" download>下载转写文本</a></section>
<section class="card"><h2>完整转写</h2>{rows or '<p>录音已导入，尚未产生转写文字。</p>'}</section></main></html>'''
    destination = folder / (course_id + '.html')
    destination.write_text(page, encoding='utf-8')
    return destination
