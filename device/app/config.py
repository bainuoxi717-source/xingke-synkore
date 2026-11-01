from pathlib import Path
import os

ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("ZHILIU_DATA_DIR", str(ROOT_DIR / "data"))).resolve()
COURSES_DIR = DATA_DIR / "courses"
IMPORTS_DIR = DATA_DIR / "imports"
DB_PATH = DATA_DIR / "zhiliu.db"
STATIC_DIR = ROOT_DIR / "app" / "static"

SERIAL_PORT = os.getenv("ZHILIU_SERIAL_PORT", "COM5")
SERIAL_BAUD = int(os.getenv("ZHILIU_SERIAL_BAUD", "921600"))
_LOCAL_ASR_MODEL = ROOT_DIR / "models" / "faster-whisper-small"
ASR_MODEL = os.getenv("ZHILIU_ASR_MODEL", str(_LOCAL_ASR_MODEL) if (_LOCAL_ASR_MODEL / "READY").exists() else "small")
ASR_DEVICE = os.getenv("ZHILIU_ASR_DEVICE", "cpu")
ASR_COMPUTE_TYPE = os.getenv("ZHILIU_ASR_COMPUTE_TYPE", "int8")
os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
LLM_BASE_URL = os.getenv("ZHILIU_LLM_BASE_URL", "")
LLM_API_KEY = os.getenv("ZHILIU_LLM_API_KEY", "")
LLM_MODEL = os.getenv("ZHILIU_LLM_MODEL", "")
EMBEDDING_MODEL = os.getenv("ZHILIU_EMBEDDING_MODEL", "")

for directory in (DATA_DIR, COURSES_DIR, IMPORTS_DIR):
    directory.mkdir(parents=True, exist_ok=True)
