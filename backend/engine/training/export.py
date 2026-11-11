"""Model bundle export (WP6 step 10).

out/model/<m1_change|m2_stain>/
    model.onnx | model.onnx.N | model.json   — the model itself
    metadata.json                             — version, features, thresholds, metrics, data hash, synthetic flag
    bundle.json                               — single uploadable file (Settings -> Models -> Upload):
                                                metadata + model (ONNX embedded base64)
"""

from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path

import numpy as np

from silkgrade_engine.model import FEATURE_NAMES, from_spec


def write_bundle(out_dir: Path, target: str, cand, version: str, metadata: dict) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    spec = cand.spec()
    files = []
    if spec["type"] == "lgbm_regressor":
        (out_dir / "model.onnx").write_bytes(base64.b64decode(spec["onnx_b64"]))
        files.append("model.onnx")
    elif spec["type"] == "lgbm_ordinal":
        for i, b in enumerate(spec["onnx_b64_list"]):
            (out_dir / f"model.onnx.{i}").write_bytes(base64.b64decode(b))
            files.append(f"model.onnx.{i}")
    else:
        (out_dir / "model.json").write_text(json.dumps(spec, indent=2), encoding="utf-8")
        files.append("model.json")
    core = json.dumps({k: v for k, v in spec.items()}, sort_keys=True).encode()
    meta = {
        "name": target,
        "version": version,
        "type": spec["type"],
        "features": FEATURE_NAMES,
        "model_files": files,
        "sha256": hashlib.sha256(core).hexdigest(),
        **metadata,
    }
    (out_dir / "metadata.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    bundle = {**meta, **spec}
    (out_dir / "bundle.json").write_text(json.dumps(bundle), encoding="utf-8")
    return bundle


def engine_matches_python(bundle: dict, cand, X: np.ndarray) -> float:
    """Max |engine runtime prediction − Python prediction| over X (ONNX vs LightGBM, JSON vs sklearn/mord).
    The engine applies the 1..5 clip, so compare clipped values."""
    m = from_spec(bundle)
    eng = np.array([m.predict(dict(zip(FEATURE_NAMES, x)))[0] for x in X])
    py = np.clip(cand.predict(X), 1.0, 5.0)
    return float(np.max(np.abs(eng - py))) if len(X) else 0.0
