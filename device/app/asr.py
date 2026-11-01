from __future__ import annotations

from pathlib import Path

from .config import ASR_MODEL, ASR_DEVICE, ASR_COMPUTE_TYPE


def transcribe_audio(path: Path) -> list[dict]:
    """Local faster-whisper transcription with segment timestamps."""
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise RuntimeError("语音识别组件尚未安装：请安装 faster-whisper 后重试") from exc
    model = WhisperModel(ASR_MODEL, device=ASR_DEVICE, compute_type=ASR_COMPUTE_TYPE)
    segments, _ = model.transcribe(str(path), language="zh", vad_filter=True, word_timestamps=False)
    return [{"start_ms": round(s.start * 1000), "end_ms": round(s.end * 1000), "text": s.text.strip()}
            for s in segments if s.text.strip()]


def marked_context(segments: list[dict], time_ms: int, before_ms: int = 45000, after_ms: int = 45000) -> str:
    selected = [s["text"] for s in segments if s["end_ms"] >= time_ms - before_ms and s["start_ms"] <= time_ms + after_ms]
    return "".join(selected).strip()
