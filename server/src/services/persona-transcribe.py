"""Local-only transcription using the already cached Whisper small model."""
import json
import sys
from faster_whisper import WhisperModel

model = WhisperModel('small', device='cpu', compute_type='int8', local_files_only=True, cpu_threads=4)
segments, info = model.transcribe(sys.argv[1], beam_size=3, vad_filter=True, clip_timestamps='0,1800')
text = '\n'.join(segment.text.strip() for segment in segments if segment.text.strip())
if not text:
    raise RuntimeError('No speech')
print(json.dumps({'text': text, 'language': info.language,
    'notice': '本机语音转写，可能有识别误差；说话人归属待核对' + ('；本次仅转写前30分钟' if info.duration > 1800 else '')}, ensure_ascii=False))
