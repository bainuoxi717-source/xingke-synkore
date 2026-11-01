from __future__ import annotations

import json
import uuid

import httpx

from .config import LLM_API_KEY, LLM_BASE_URL, LLM_MODEL
from .db import connection
from .pipeline import retrieve_chunks


def _llm_available() -> bool:
    return bool(LLM_BASE_URL and LLM_API_KEY and LLM_MODEL)


def _generate_with_llm(context: str, sources: list[dict]) -> dict:
    source_text = "\n\n".join(f"[课件第 {s['page']} 页]\n{s['content']}" for s in sources)
    prompt = f"""你是严谨的学习内容编辑。根据课堂标记片段和课件原文，生成一个知识点主帖、三条回复式详解和一个误区判断帖。
要求：主帖只讲高层概览；回复依次解释直觉、细节和例子；误区必须是常见误解，但要明确给出正确答案，不能将错误事实伪装成普通知识。
只能使用所给材料，材料不足时在正文中明确说明，不得编造引用。输出严格 JSON，不要 Markdown，结构为：
{{"knowledge_point":"...","title":"...","body":"...","replies":["...","...","..."],"myth":{{"statement":"...","answer":true,"explanation":"..."}}}}

[课堂标记前后 transcript]
{context}

[课件原文]
{source_text}"""
    response = httpx.post(
        f"{LLM_BASE_URL.rstrip('/')}/chat/completions",
        headers={"Authorization": f"Bearer {LLM_API_KEY}"},
        json={"model": LLM_MODEL, "messages": [{"role": "user", "content": prompt}],
              "temperature": 0.3, "response_format": {"type": "json_object"}},
        timeout=90,
    )
    response.raise_for_status()
    content = response.json()["choices"][0]["message"]["content"]
    result = json.loads(content)
    if not isinstance(result.get("replies"), list) or len(result["replies"]) != 3:
        raise ValueError("模型返回的详解数量不正确")
    if not isinstance(result.get("myth"), dict) or not isinstance(result["myth"].get("answer"), bool):
        raise ValueError("模型返回的误区判断格式不正确")
    return result


def _fallback(context: str, sources: list[dict], index: int) -> dict:
    excerpt = sources[0]["content"] if sources else "暂未检索到对应课件原文，请先上传包含该知识点的课件。"
    short = excerpt[:160] + ("…" if len(excerpt) > 160 else "")
    return {
        "knowledge_point": f"课堂薄弱标记 {index}",
        "title": f"你在 {index} 号标记处留下了疑问",
        "body": f"课堂相关片段：{context or '语音识别未覆盖该时间点，请检查录音与标记时间。'}",
        "replies": [f"课件依据：{short}", "当前为无模型模板模式；配置兼容 OpenAI 的模型接口后，可生成逐步详解与举例。", "如果课件原文与课堂片段不匹配，请在生成前检查课件和课程是否对应。"],
        "myth": {"statement": "只要在课堂上按下标记，系统就能在没有语音和课件的情况下知道具体不懂什么。",
                 "answer": False, "explanation": "标记只记录时间。系统还需要课堂 transcript 和对应课件，才能定位并解释知识点。"},
    }


def generate_course_posts(course_id: str) -> dict:
    with connection() as db:
        marks = db.execute("SELECT * FROM marks WHERE course_id = ? ORDER BY time_ms", (course_id,)).fetchall()
        db.execute("DELETE FROM posts WHERE course_id = ?", (course_id,))
    if not marks:
        raise ValueError("这门课没有“不懂”标记")
    count = 0
    for index, mark in enumerate(marks, 1):
        sources = retrieve_chunks(course_id, mark["transcript_excerpt"], limit=3)
        result = _generate_with_llm(mark["transcript_excerpt"], sources) if _llm_available() else _fallback(mark["transcript_excerpt"], sources, index)
        source = sources[0] if sources else {"content": "", "page": None}
        replies = [{"id": uuid.uuid4().hex, "body": str(text)} for text in result["replies"]]
        with connection() as db:
            db.execute("""
                INSERT INTO posts(id, course_id, kind, title, body, source_excerpt, source_page,
                                  priority, knowledge_point, replies_json, myth_json)
                VALUES (?, ?, 'concept', ?, ?, ?, ?, ?, ?, ?, NULL)
            """, (uuid.uuid4().hex, course_id, result["title"], result["body"], source["content"],
                  source["page"], 100 - (index - 1) * 5, result["knowledge_point"],
                  json.dumps(replies, ensure_ascii=False)))
            myth = result["myth"]
            db.execute("""
                INSERT INTO posts(id, course_id, kind, title, body, source_excerpt, source_page,
                                  priority, knowledge_point, replies_json, myth_json)
                VALUES (?, ?, 'myth', ?, ?, ?, ?, ?, ?, '[]', ?)
            """, (uuid.uuid4().hex, course_id, f"误区判断：{result['knowledge_point']}",
                  "先独立判断，再查看答案和课件依据。", source["content"], source["page"],
                  95 - (index - 1) * 5, result["knowledge_point"], json.dumps(myth, ensure_ascii=False)))
            db.execute("UPDATE marks SET knowledge_point = ? WHERE id = ?", (result["knowledge_point"], mark["id"]))
        count += 2
    return {"ok": True, "course_id": course_id, "post_count": count,
            "mode": "llm" if _llm_available() else "template"}
