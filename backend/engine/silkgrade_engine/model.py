"""ML plug-in point (Section 10.1).

V1 runs in formula-only mode: ``model_rating = None`` and ``final = iso``.
A trained model can be activated later without code changes: the API passes the
active model file per model name (``m1_change`` / ``m2_stain``) in the grade request.

Supported model files (all produced by ``training/run.py``):

* ``type: linear``            — JSON coefficients on standardised features (Ridge).
* ``type: ordinal_logistic``  — JSON, all-threshold ordinal logistic (mord.LogisticAT):
                                P(y <= k) = sigmoid(theta_k - w.x); rating = expected grade.
* ``type: lgbm_regressor``    — LightGBM regressor exported to ONNX, embedded base64 in the JSON bundle.
* ``type: lgbm_ordinal``      — cumulative-binary LightGBM (one ONNX classifier per threshold,
                                P(y > c_k)); rating = expected grade.
* a bare ``.onnx`` file       — regressor on FEATURE_NAMES (legacy).
"""

from __future__ import annotations

import base64
import hashlib
import json
from functools import lru_cache
from pathlib import Path
from typing import Protocol

import numpy as np

from . import config

CHANGE_KINDS = {"CHANGE_OVERALL", "CHANGE_GROUND", "CHANGE_MOTIF", "CHANGE_WORST"}
STAIN_KINDS = {"STAIN_ADJ1", "STAIN_ADJ2", "STAIN_WORST"}

WARNING_FLAGS = {
    "w_blur": "blur", "w_clipping": "clipping", "w_glare": "glare", "w_lowres": "lowRes",
    "w_device": "DIFFERENT_DEVICE_BEFORE_AFTER", "w_registration": "REGISTRATION_FAILED",
    "w_ref_card": "noRefCard",
}

# Flat feature vector shared by inference and training (brief Section 10.3):
# ISO rating, ΔE*ab, ΔE00, ΔE_F, ΔL, ΔC, ΔH, p10/p50/p90, std, base L*a*b*, cluster stats
# (area share), fabric one-hots, warning flags.
FEATURE_NAMES = [
    "iso_rating", "dE_ab", "dE00", "dE_F", "dL", "dC", "dH", "p10", "p50", "p90", "std",
    "L_before", "a_before", "b_before", "area_share",
    "fibre_silk", "fibre_cotton", "fabric_printed", "n_warnings",
    *WARNING_FLAGS.keys(),
]


def flatten_features(features: dict, iso_rating: float, context: dict | None = None) -> dict:
    ctx = context or {}
    lab_b = features.get("lab_before") or [0.0, 0.0, 0.0]
    fibre = (ctx.get("fibre") or "").lower()
    warns = set(features.get("warnings") or ctx.get("warnings") or [])
    out = {
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
        "n_warnings": float(ctx.get("n_warnings", len([w for w in warns if w != "noRefCard"]))),
    }
    for k, w in WARNING_FLAGS.items():
        out[k] = 1.0 if w in warns else 0.0
    return out


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
        self.review_margin = 0.0

    def predict(self, features: dict) -> tuple[float, float]:
        return float(features["iso_rating"]), 0.0


def _sigmoid(z):
    return 1.0 / (1.0 + np.exp(-z))


class _Base:
    is_formula_only = False

    def __init__(self, spec: dict):
        self.name = spec["name"]
        self.version = str(spec["version"])
        self.features = list(spec.get("features", FEATURE_NAMES))
        self.residual_std = float(spec.get("residual_std", 0.0))
        # calibrated 95 % half-width multiplier (training/run.py tunes it on validation)
        self.interval_z = float(spec.get("interval_z", 1.96))
        self.review_margin = float(spec.get("review_margin", 0.0))
        self.mean = np.asarray(spec.get("scaler_mean", [0.0] * len(self.features)), dtype=np.float64)
        self.scale = np.asarray(spec.get("scaler_scale", [1.0] * len(self.features)), dtype=np.float64)

    def _x(self, features: dict) -> np.ndarray:
        x = np.asarray([features.get(f, 0.0) for f in self.features], dtype=np.float64)
        return (x - self.mean) / np.where(self.scale == 0, 1.0, self.scale)

    def std(self) -> float:
        """Standard deviation such that ±1.96·std matches the calibrated 95 % interval."""
        return self.residual_std * self.interval_z / 1.96

    def rating(self, x: np.ndarray) -> float:  # pragma: no cover - abstract
        raise NotImplementedError

    def predict(self, features: dict) -> tuple[float, float]:
        y = self.rating(self._x(features))
        return min(max(float(y), 1.0), 5.0), self.std()


class LinearJsonModel(_Base):
    """Linear model on the flat feature vector, stored as JSON coefficients."""

    def __init__(self, spec: dict):
        super().__init__(spec)
        self.coef = np.asarray(spec["coef"], dtype=np.float64)
        self.intercept = float(spec["intercept"])

    def rating(self, x):
        return self.intercept + x @ self.coef


class OrdinalLogisticModel(_Base):
    """All-threshold ordinal logistic regression: P(y <= k) = sigmoid(theta_k - w.x)."""

    def __init__(self, spec: dict):
        super().__init__(spec)
        self.coef = np.asarray(spec["coef"], dtype=np.float64)
        self.theta = np.asarray(spec["theta"], dtype=np.float64)
        self.classes = np.asarray(spec["classes"], dtype=np.float64)  # grade value per class index

    def proba(self, x: np.ndarray) -> np.ndarray:
        cum = _sigmoid(self.theta - x @ self.coef)  # P(y <= k), k = 0..K-2
        cum = np.concatenate([[0.0], np.maximum.accumulate(cum), [1.0]])
        return np.clip(np.diff(cum), 0.0, 1.0)

    def rating(self, x):
        return float(self.proba(x) @ self.classes)


def _onnx_session(b64: str):
    import onnxruntime as ort  # type: ignore

    return ort.InferenceSession(base64.b64decode(b64), providers=["CPUExecutionProvider"])


def _onnx_run(sess, x: np.ndarray) -> np.ndarray:
    name = sess.get_inputs()[0].name
    return sess.run(None, {name: x.astype(np.float32)[None, :]})


class LgbmRegressorModel(_Base):
    def __init__(self, spec: dict):
        super().__init__(spec)
        self.sess = _onnx_session(spec["onnx_b64"])

    def rating(self, x):
        return float(np.asarray(_onnx_run(self.sess, x)[0]).ravel()[0])


class LgbmOrdinalModel(_Base):
    """Cumulative binary classifiers: P(y > c_k) for each threshold; rating = expected grade."""

    def __init__(self, spec: dict):
        super().__init__(spec)
        self.classes = np.asarray(spec["classes"], dtype=np.float64)
        self.sessions = [_onnx_session(b) for b in spec["onnx_b64_list"]]

    def p_greater(self, x: np.ndarray) -> np.ndarray:
        ps = []
        for s in self.sessions:
            out = _onnx_run(s, x)
            prob = out[1]
            if isinstance(prob, list):  # zipmap output: [{0: p0, 1: p1}]
                p = float(prob[0][1])
            else:
                p = float(np.asarray(prob).reshape(-1)[-1])
            ps.append(p)
        # P(y > c_k) must not increase with k
        return np.minimum.accumulate(np.asarray(ps))

    def rating(self, x):
        steps = np.diff(self.classes)
        return float(self.classes[0] + np.sum(steps * self.p_greater(x)))


class OnnxModel(_Base):  # pragma: no cover - legacy bare .onnx regressor
    def __init__(self, path: Path, name: str, version: str):
        super().__init__({"name": name, "version": version})
        import onnxruntime as ort  # type: ignore

        self.sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])

    def _x(self, features):
        return np.asarray([features.get(f, 0.0) for f in FEATURE_NAMES], dtype=np.float64)

    def rating(self, x):
        return float(np.asarray(_onnx_run(self.sess, x)[0]).ravel()[0])


MODEL_TYPES = {
    "linear": LinearJsonModel,
    "ordinal_logistic": OrdinalLogisticModel,
    "lgbm_regressor": LgbmRegressorModel,
    "lgbm_ordinal": LgbmOrdinalModel,
}


def from_spec(spec: dict):
    kind = spec.get("type", "linear")
    if kind not in MODEL_TYPES:
        raise ValueError(f"unknown model type {kind!r}")
    return MODEL_TYPES[kind](spec)


def file_sha256(path: str | Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


@lru_cache(maxsize=16)
def _load_cached(path: str, sha: str, name: str, version: str):
    p = Path(path)
    if p.suffix.lower() == ".onnx":
        return OnnxModel(p, name, version)
    return from_spec(json.loads(p.read_text(encoding="utf-8")))


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
