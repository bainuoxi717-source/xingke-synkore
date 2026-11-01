import json
import os
from pathlib import Path

from faster_whisper import WhisperModel

audio = Path(__file__).parent / "assets" / "english.flac"
local_model = Path(__file__).resolve().parents[1] / "models" / "faster-whisper-tiny"
model_name = os.getenv("ZHILIU_TEST_ASR_MODEL", str(local_model) if (local_model / "READY").exists() else "tiny")
model = WhisperModel(model_name, device="cpu", compute_type="int8")
segments, info = model.transcribe(str(audio), language="en", vad_filter=True)
result = [{"start_ms": round(s.start * 1000), "end_ms": round(s.end * 1000), "text": s.text.strip()} for s in segments]
print(json.dumps({"language": info.language, "segments": result}, ensure_ascii=False, indent=2))
if not result:
    raise SystemExit("ASR smoke test produced no segments")
