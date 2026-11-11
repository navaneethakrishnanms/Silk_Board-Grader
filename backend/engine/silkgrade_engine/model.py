"""ML plug-in point (Section 10.1).

V1 runs in formula-only mode: ``model_rating = None`` and ``final = iso``.
A trained model (JSON coefficients, or ONNX if ``onnxruntime`` is installed)
can be activated later without code changes: the API passes the active model
file per model name (``m1_change`` / ``m2_stain``) in the grade request.
"""

from __future__ import annotations

import hashlib
import json
from functools import lru_cache
from pathlib import Path
from typing import Protocol

import numpy as np

from . import config

CHANGE_KINDS = {"CHANGE_OVERALL", "CHANGE_GROUND", "CHANGE_MOTIF", "CHANGE_WORST"}
STAIN_KINDS = {"STAIN_ADJ1", "STAIN_ADJ2", "STAIN_WORST"}

# Flat feature vector shared by inference and training (training/train.py).
FEATURE_NAMES = [
    "iso_rating", "dE_ab", "dE00", "dE_F", "dL", "dC", "dH", "p10", "p50", "p90", "std",
    "L_before", "a_before", "b_before", "area_share",
    "fibre_silk", "fibre_cotton", "fabric_printed", "n_warnings",
]


def flatten_features(features: dict, iso_rating: float, context: dict | None = None) -> dict:
    ctx = context or {}
    lab_b = features.get("lab_before") or [0.0, 0.0, 0.0]
    fibre = (ctx.get("fibre") or "").lower()
    return {
        "iso_rating": float(iso_rating),
        "dE_ab": float(features.get("dE_ab", 0.0)),
        "dE00": float(features.get("dE00", 0.0)),
        "dE_F": float(features.get("dE_F", features.get("dE00", 0.0))),
        "dL": float(features.get("dL", 0.0)),
        "dC": float(features.get("dC", 0.0)),
        "dH": float(features.get("dH", 0.0)),
        "p10": float(features.get("p10", 0.0)),
        "p50": float(features.get("p50", 0.0)),
        "p90": float(features.get("p90", 0.0)),
        "std": float(features.get("std", 0.0)),
        "L_before": float(lab_b[0]), "a_before": float(lab_b[1]), "b_before": float(lab_b[2]),
        "area_share": float(features.get("area_share", 1.0)),
        "fibre_silk": 1.0 if fibre == "silk" else 0.0,
        "fibre_cotton": 1.0 if fibre == "cotton" else 0.0,
        "fabric_printed": 1.0 if ctx.get("fabric_type") == "PRINTED" else 0.0,
        "n_warnings": float(ctx.get("n_warnings", 0)),
    }


class GradeModel(Protocol):
    name: str
    version: str

    def predict(self, features: dict) -> tuple[float, float]:  # rating, std
        ...


class FormulaOnly:
    """Active in V1: returns the ISO rating unchanged."""

    def __init__(self, name: str = "formula"):
        self.name = name
        self.version = config.MODEL_VERSION_FORMULA_ONLY
        self.is_formula_only = True

    def predict(self, features: dict) -> tuple[float, float]:
        return float(features["iso_rating"]), 0.0


class LinearJsonModel:
    """Linear model on the flat feature vector, stored as JSON coefficients."""

    is_formula_only = False

    def __init__(self, spec: dict):
        self.name = spec["name"]
        self.version = spec["version"]
        self.features = list(spec["features"])
        self.coef = np.asarray(spec["coef"], dtype=np.float64)
        self.intercept = float(spec["intercept"])
        self.residual_std = float(spec.get("residual_std", 0.0))
        self.mean = np.asarray(spec.get("scaler_mean", [0.0] * len(self.features)), dtype=np.float64)
        self.scale = np.asarray(spec.get("scaler_scale", [1.0] * len(self.features)), dtype=np.float64)

    def predict(self, features: dict) -> tuple[float, float]:
        x = np.asarray([features.get(f, 0.0) for f in self.features], dtype=np.float64)
        x = (x - self.mean) / np.where(self.scale == 0, 1.0, self.scale)
        y = float(self.intercept + x @ self.coef)
        return min(max(y, 1.0), 5.0), self.residual_std


class OnnxModel:  # pragma: no cover - requires onnxruntime
    is_formula_only = False

    def __init__(self, path: Path, name: str, version: str):
        import onnxruntime as ort  # type: ignore

        self.sess = ort.InferenceSession(str(path))
        self.name, self.version = name, version
        self.input = self.sess.get_inputs()[0].name

    def predict(self, features: dict) -> tuple[float, float]:
        x = np.asarray([[features.get(f, 0.0) for f in FEATURE_NAMES]], dtype=np.float32)
        y = float(np.asarray(self.sess.run(None, {self.input: x})[0]).ravel()[0])
        return min(max(y, 1.0), 5.0), 0.0


def file_sha256(path: str | Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


@lru_cache(maxsize=16)
def _load_cached(path: str, sha: str, name: str, version: str):
    p = Path(path)
    if p.suffix.lower() == ".onnx":
        return OnnxModel(p, name, version)
    spec = json.loads(p.read_text(encoding="utf-8"))
    return LinearJsonModel(spec)


def load_active(spec: dict | None, name: str) -> GradeModel:
    """``spec`` = ``{"path": ..., "version": ...}`` of the active ModelVersion, or
    None. Falls back to FormulaOnly when nothing is active or loading fails."""
    if not spec or not spec.get("path") or not Path(spec["path"]).exists():
        return FormulaOnly(name)
    try:
        return _load_cached(str(spec["path"]), file_sha256(spec["path"]), name, str(spec.get("version", "")))
    except Exception:
        return FormulaOnly(name)


def correct(model: GradeModel, flat: dict) -> tuple[float | None, float]:
    """Returns (model_rating or None in formula-only mode, model std)."""
    if getattr(model, "is_formula_only", False):
        return None, 0.0
    rating, std = model.predict(flat)
    return rating, std
