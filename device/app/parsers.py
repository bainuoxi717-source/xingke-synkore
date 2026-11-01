from __future__ import annotations

import re
from pathlib import Path


def extract_document(path: Path) -> list[dict]:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        from pypdf import PdfReader
        return [{"page": i, "text": page.extract_text() or ""}
                for i, page in enumerate(PdfReader(path).pages, 1)]
    if suffix in {".ppt", ".pptx"}:
        if suffix == ".ppt":
            raise ValueError("请先将旧版 .ppt 转换为 .pptx")
        from pptx import Presentation
        pages = []
        for i, slide in enumerate(Presentation(path).slides, 1):
            texts = [shape.text for shape in slide.shapes if hasattr(shape, "text_frame") and shape.has_text_frame]
            pages.append({"page": i, "text": "\n".join(texts)})
        return pages
    if suffix in {".txt", ".md"}:
        return [{"page": 1, "text": path.read_text(encoding="utf-8")}]
    raise ValueError("目前支持 PDF、PPTX、TXT 和 Markdown 课件")


def chunk_pages(pages: list[dict], target_chars: int = 700, overlap: int = 100) -> list[dict]:
    chunks = []
    for page in pages:
        text = re.sub(r"[ \t]+", " ", page["text"]).strip()
        if not text:
            continue
        start = 0
        while start < len(text):
            end = min(len(text), start + target_chars)
            if end < len(text):
                boundary = max(text.rfind("。", start, end), text.rfind("\n", start, end))
                if boundary > start + target_chars // 2:
                    end = boundary + 1
            content = text[start:end].strip()
            if content:
                chunks.append({"page": page["page"], "content": content})
            if end >= len(text):
                break
            start = max(start + 1, end - overlap)
    return chunks
