from __future__ import annotations

import httpx

from .config import EMBEDDING_MODEL, LLM_API_KEY, LLM_BASE_URL


def embeddings_available() -> bool:
    return bool(LLM_BASE_URL and LLM_API_KEY and EMBEDDING_MODEL)


def embed_texts(texts: list[str]) -> list[list[float]]:
    if not embeddings_available():
        raise RuntimeError("向量嵌入接口尚未配置")
    response = httpx.post(
        f"{LLM_BASE_URL.rstrip('/')}/embeddings",
        headers={"Authorization": f"Bearer {LLM_API_KEY}"},
        json={"model": EMBEDDING_MODEL, "input": texts},
        timeout=90,
    )
    response.raise_for_status()
    data = sorted(response.json()["data"], key=lambda item: item["index"])
    vectors = [[float(value) for value in item["embedding"]] for item in data]
    if len(vectors) != len(texts):
        raise ValueError("向量接口返回数量与课件片段数量不一致")
    return vectors


def cosine_similarity(left: list[float], right: list[float]) -> float:
    if len(left) != len(right) or not left:
        return 0.0
    dot = sum(a * b for a, b in zip(left, right))
    norm_left = sum(a * a for a in left) ** 0.5
    norm_right = sum(b * b for b in right) ** 0.5
    return dot / (norm_left * norm_right) if norm_left and norm_right else 0.0
