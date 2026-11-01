from __future__ import annotations

import json

from .db import connection, utc_now

COURSE_ID = "demo-function-limit"


def seed_demo() -> str:
    source = (
        "设函数 f(x) 在点 x0 的某一去心邻域内有定义。如果存在常数 A，对于任意给定的正数 ε，"
        "总存在正数 δ，使得当 0 < |x - x0| < δ 时，恒有 |f(x) - A| < ε，则称 A 为 f(x) 当 x 趋近于 x0 时的极限。"
    )
    posts = [
        {
            "id": "demo-limit-overview", "kind": "concept", "title": "你标记的薄弱点：函数极限",
            "body": "极限关心的是 x 越来越接近 x0 时，函数值趋向哪里，而不是 f(x0) 恰好等于多少。",
            "source_excerpt": source, "source_page": 3, "priority": 98,
            "knowledge_point": "函数极限的去心邻域定义",
            "replies": [
                {"id": "r1", "body": "直观理解：你给出任意小的误差 ε，我都能把 x 限制在足够小的范围内，让 f(x) 与 A 的距离小于 ε。"},
                {"id": "r2", "body": "为什么用 0 < |x-x0|？因为趋近过程排除了 x=x0 本身，所以极限是否存在与 f(x0) 是否有定义没有必然关系。"},
                {"id": "r3", "body": "例：f(x)=(x²-1)/(x-1) 在 x=1 处无定义，但 x≠1 时 f(x)=x+1，因此 x→1 时极限为 2。"},
            ], "myth": None,
        },
        {
            "id": "demo-limit-myth", "kind": "myth", "title": "误区判断：极限值就是函数值？",
            "body": "先别急着看解析。结合“去心邻域”的定义，判断下面这句话。",
            "source_excerpt": source, "source_page": 3, "priority": 94,
            "knowledge_point": "极限与函数值的区别", "replies": [],
            "myth": {
                "statement": "只要 x→x0 时 f(x) 的极限存在，就一定有 lim f(x)=f(x0)。",
                "answer": False,
                "explanation": "错误。函数在 x0 处可能没有定义，或函数值与极限值不同。只有额外满足连续条件时，二者才相等。",
            },
        },
        {
            "id": "demo-epsilon-delta", "kind": "concept", "title": "ε 和 δ 到底谁先谁后？",
            "body": "先任意给定 ε，再寻找能够满足要求的 δ。顺序不能反：δ 可以依赖 ε，但 ε 不能由 δ 指定。",
            "source_excerpt": source, "source_page": 3, "priority": 72,
            "knowledge_point": "ε-δ 定义中的量词顺序",
            "replies": [
                {"id": "r1", "body": "把它想成误差挑战：别人先把目标误差 ε 给你，你再证明存在对应的 δ。不能只对一个特定 ε 有效，而要对每个 ε>0 都有效。"},
                {"id": "r2", "body": "证明时通常从 |f(x)-A|<ε 出发，反推出 |x-x0| 需要小于什么，再据此选择 δ。"},
            ], "myth": None,
        },
    ]
    with connection() as db:
        db.execute("DELETE FROM courses WHERE id = ?", (COURSE_ID,))
        db.execute("""
            INSERT INTO courses(id, title, document_name, audio_duration_ms, transcript_status, created_at)
            VALUES (?, ?, ?, ?, 'ready', ?)
        """, (COURSE_ID, "高等数学 · 函数极限", "函数极限课堂课件.pdf", 2700000, utc_now()))
        db.executemany(
            "INSERT INTO marks(course_id, time_ms, transcript_excerpt, knowledge_point) VALUES (?, ?, ?, ?)",
            [(COURSE_ID, 325000, "这里为什么要用去心邻域", "函数极限的去心邻域定义"),
             (COURSE_ID, 1120000, "任意给定 ε，总存在 δ", "ε-δ 定义中的量词顺序")],
        )
        db.execute("INSERT INTO chunks(id, course_id, source_name, page, content) VALUES (?, ?, ?, ?, ?)", ("demo-chunk-1", COURSE_ID, "函数极限课堂课件.pdf", 3, source))
        for post in posts:
            db.execute("""
                INSERT INTO posts(id, course_id, kind, title, body, source_excerpt, source_page,
                                  priority, knowledge_point, replies_json, myth_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (post["id"], COURSE_ID, post["kind"], post["title"], post["body"],
                  post["source_excerpt"], post["source_page"], post["priority"],
                  post["knowledge_point"], json.dumps(post["replies"], ensure_ascii=False),
                  json.dumps(post["myth"], ensure_ascii=False) if post["myth"] else None))
    return COURSE_ID
