"""Engine service settings (environment variables, see backend/engine/.env.example)."""

from __future__ import annotations

import os
from pathlib import Path

try:
    from dotenv import load_dotenv  # type: ignore

    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
except Exception:  # pragma: no cover - python-dotenv optional
    pass

ENGINE_ROOT = Path(__file__).resolve().parents[1]
_storage = Path(os.getenv("STORAGE_ROOT", str(ENGINE_ROOT.parents[1] / "storage")))
# relative paths are resolved against backend/engine so the service works from any cwd
STORAGE_ROOT = (_storage if _storage.is_absolute() else ENGINE_ROOT / _storage).resolve()
DERIVED_DIR = os.getenv("ENGINE_DERIVED_DIR", "derived")
INTERNAL_TOKEN = os.getenv("ENGINE_INTERNAL_TOKEN", "")
HOST = os.getenv("ENGINE_HOST", "127.0.0.1")
PORT = int(os.getenv("ENGINE_PORT", "8001"))
LOG_LEVEL = os.getenv("ENGINE_LOG_LEVEL", "info")
