"""engine-svc: thin, stateless FastAPI wrapper around ``silkgrade_engine``.

Internal only — the public API (backend/api) is the single entry point for
clients. All paths in requests and responses are relative to STORAGE_ROOT
(a volume shared with the API); absolute paths outside it are rejected.

Run:  uvicorn engine_svc.main:app --host 127.0.0.1 --port 8001
"""

from __future__ import annotations

import logging
import re
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException

import silkgrade_engine
from silkgrade_engine import config as engine_config
from silkgrade_engine.pipeline import check_alignment, detect, grade_test, inspect_image

from . import settings
from .schemas import DetectRequest, GradeRequest, InspectRequest, RegisterRequest

log = logging.getLogger("engine_svc")
logging.basicConfig(level=settings.LOG_LEVEL.upper())

app = FastAPI(title="SilkGrade engine-svc", version=silkgrade_engine.__version__,
              docs_url="/docs", redoc_url=None)


def check_token(x_engine_token: str | None = Header(default=None)) -> None:
    if settings.INTERNAL_TOKEN and x_engine_token != settings.INTERNAL_TOKEN:
        raise HTTPException(status_code=401, detail="invalid engine token")


def resolve(rel: str) -> Path:
    """Resolve a storage-relative path, refusing anything outside STORAGE_ROOT."""
    p = (settings.STORAGE_ROOT / rel).resolve() if not Path(rel).is_absolute() else Path(rel).resolve()
    try:
        p.relative_to(settings.STORAGE_ROOT)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"path outside storage: {rel}")
    if not p.exists():
        raise HTTPException(status_code=404, detail=f"file not found: {rel}")
    return p


def rel(p: str | Path | None) -> str | None:
    if p is None:
        return None
    return Path(p).resolve().relative_to(settings.STORAGE_ROOT).as_posix()


def safe_id(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]", "_", s)[:80] or "test"


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "engine_version": silkgrade_engine.__version__,
        "model_versions": {"m1_change": engine_config.MODEL_VERSION_FORMULA_ONLY,
                           "m2_stain": engine_config.MODEL_VERSION_FORMULA_ONLY},
        "dE_F_verified": engine_config.DE_F_VERIFIED,
        "storage_root": str(settings.STORAGE_ROOT),
    }


@app.post("/inspect", dependencies=[Depends(check_token)])
def inspect(req: InspectRequest) -> dict:
    src = resolve(req.path)
    from silkgrade_engine.io import sha256_file

    digest = sha256_file(src)
    preview = settings.STORAGE_ROOT / settings.DERIVED_DIR / "previews" / f"{digest[:32]}.jpg"
    try:
        out = inspect_image(str(src), str(preview), expect_white=req.expect_white)
    except Exception as e:  # unreadable / unsupported file
        log.exception("inspect failed")
        raise HTTPException(status_code=422, detail=f"cannot read image: {e}")
    out["preview_path"] = rel(out["preview_path"])
    return out


@app.post("/detect-regions", dependencies=[Depends(check_token)])
def detect_regions(req: DetectRequest) -> dict:
    src = resolve(req.path)
    return detect(str(src), list(req.expected_pieces))


@app.post("/register", dependencies=[Depends(check_token)])
def register_pair(req: RegisterRequest) -> dict:
    """Alignment pre-check for the UI (extension of the Section 7 contract)."""
    before = {"path": str(resolve(req.before.path)), "polygon": req.before.polygon}
    after = {"path": str(resolve(req.after.path)), "polygon": req.after.polygon}
    return check_alignment(before, after)


@app.post("/grade", dependencies=[Depends(check_token)])
def grade(req: GradeRequest) -> dict:
    body = req.model_dump()
    for pair in body["pairs"].values():
        for side in ("before", "after"):
            pair[side]["path"] = str(resolve(pair[side]["path"]))
    rc = body.get("ref_card") or {}
    for side in ("before", "after"):
        if rc.get(side):
            rc[side]["path"] = str(resolve(rc[side]["path"]))
    for name, spec in list((body["options"].get("models") or {}).items()):
        if spec:
            spec["path"] = str(resolve(spec["path"]))
    if body["options"].get("manual_points") is None:
        body["options"].pop("manual_points", None)

    out_dir = settings.STORAGE_ROOT / settings.DERIVED_DIR / safe_id(req.test_id)
    try:
        result = grade_test(body, out_dir)
    except KeyError as e:
        raise HTTPException(status_code=422, detail=f"missing pair: {e}")
    for g in result["grades"]:
        g["heatmap_path"] = rel(g.get("heatmap_path"))
    return result
