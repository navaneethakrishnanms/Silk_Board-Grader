"""Candidate models for M1 (colour change) and M2 (staining) — WP6 step 4.

Order = simplicity (selection keeps the simplest that beats the ISO baseline):
    baseline (ISO formula) < linear < ordinal_logistic < lgbm_regressor < lgbm_ordinal
Every candidate predicts a continuous rating in grade units (1..5); evaluation rounds to half grades.
"""

from __future__ import annotations

import base64
import warnings

import numpy as np
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler

from silkgrade_engine.config import GRADES
from silkgrade_engine.model import FEATURE_NAMES

ISO_IDX = FEATURE_NAMES.index("iso_rating")
LGBM_PARAMS = dict(
    n_estimators=150,
    learning_rate=0.05,
    num_leaves=15,
    min_child_samples=8,
    subsample=0.9,
    subsample_freq=1,
    colsample_bytree=0.9,
    verbose=-1,
    random_state=0,
)


class Candidate:
    name = "base"
    simplicity = 0

    def fit(self, X: np.ndarray, y: np.ndarray) -> Candidate:  # pragma: no cover
        raise NotImplementedError

    def predict(self, X: np.ndarray) -> np.ndarray:  # pragma: no cover
        raise NotImplementedError

    def spec(self) -> dict:  # pragma: no cover
        raise NotImplementedError


class Baseline(Candidate):
    """ISO 105-A04/A05 formula rating (what the engine reports in formula-only mode)."""

    name, simplicity = "baseline_iso", 0

    def fit(self, X, y):
        return self

    def predict(self, X):
        return np.clip(X[:, ISO_IDX], 1.0, 5.0)


class Linear(Candidate):
    """Reference: ridge regression on standardised features."""

    name, simplicity = "linear", 1

    def fit(self, X, y):
        self.scaler = StandardScaler().fit(X)
        self.reg = Ridge(alpha=1.0).fit(self.scaler.transform(X), y)
        return self

    def predict(self, X):
        return np.clip(self.reg.predict(self.scaler.transform(X)), 1.0, 5.0)

    def spec(self):
        return {
            "type": "linear",
            "coef": self.reg.coef_.tolist(),
            "intercept": float(self.reg.intercept_),
            "scaler_mean": self.scaler.mean_.tolist(),
            "scaler_scale": self.scaler.scale_.tolist(),
        }


def _class_index(y: np.ndarray, classes: np.ndarray) -> np.ndarray:
    return np.searchsorted(classes, y)


class OrdinalLogistic(Candidate):
    """All-threshold ordinal logistic regression (mord.LogisticAT)."""

    name, simplicity = "ordinal_logistic", 2

    def fit(self, X, y):
        import mord

        self.scaler = StandardScaler().fit(X)
        self.classes = np.unique(y)
        self.m = mord.LogisticAT(alpha=1.0, max_iter=2000).fit(self.scaler.transform(X), _class_index(y, self.classes))
        return self

    def proba(self, X):
        Z = self.scaler.transform(X)
        cum = 1.0 / (1.0 + np.exp(-(self.m.theta_[None, :] - Z @ self.m.coef_[:, None])))
        cum = np.maximum.accumulate(cum, axis=1)
        cum = np.hstack([np.zeros((len(Z), 1)), cum, np.ones((len(Z), 1))])
        return np.clip(np.diff(cum, axis=1), 0.0, 1.0)

    def predict(self, X):
        return self.proba(X) @ self.classes

    def spec(self):
        return {
            "type": "ordinal_logistic",
            "coef": self.m.coef_.tolist(),
            "theta": self.m.theta_.tolist(),
            "classes": self.classes.tolist(),
            "scaler_mean": self.scaler.mean_.tolist(),
            "scaler_scale": self.scaler.scale_.tolist(),
        }


class LgbmRegressor(Candidate):
    """LightGBM regressor on the numeric grade (rounded at evaluation)."""

    name, simplicity = "lgbm_regressor", 3

    def fit(self, X, y):
        import lightgbm as lgb

        self.m = lgb.LGBMRegressor(**LGBM_PARAMS).fit(X.astype(np.float32), y)
        return self

    def predict(self, X):
        return np.clip(self.m.predict(X.astype(np.float32)), 1.0, 5.0)

    def onnx_bytes(self) -> bytes:
        # split=1: each tree's output is summed in double precision, so the ONNX model matches
        # LightGBM to < 1e-6 (float32 accumulation alone drifts by a few 1e-6)
        return _lgbm_to_onnx(self.m, X_dim=len(FEATURE_NAMES), split=1)

    def spec(self):
        return {"type": "lgbm_regressor", "onnx_b64": base64.b64encode(self.onnx_bytes()).decode()}


class LgbmOrdinal(Candidate):
    """Cumulative-binary ordinal LightGBM: one classifier per threshold P(y > c_k)."""

    name, simplicity = "lgbm_ordinal", 4

    def fit(self, X, y):
        import lightgbm as lgb

        self.classes = np.unique(y)
        self.models = []
        for c in self.classes[:-1]:
            t = (y > c).astype(int)
            self.models.append(lgb.LGBMClassifier(**LGBM_PARAMS).fit(X.astype(np.float32), t))
        return self

    def p_greater(self, X):
        P = (
            np.column_stack([m.predict_proba(X.astype(np.float32))[:, 1] for m in self.models])
            if self.models
            else np.zeros((len(X), 0))
        )
        return np.minimum.accumulate(P, axis=1)

    def predict(self, X):
        if len(self.classes) == 1:
            return np.full(len(X), self.classes[0])
        return self.classes[0] + self.p_greater(X) @ np.diff(self.classes)

    def spec(self):
        return {
            "type": "lgbm_ordinal",
            "classes": self.classes.tolist(),
            "onnx_b64_list": [base64.b64encode(_lgbm_to_onnx(m, X_dim=len(FEATURE_NAMES))).decode() for m in self.models],
        }


def _lgbm_to_onnx(model, X_dim: int, split: int | None = None) -> bytes:
    import onnxmltools
    from onnxmltools.convert.common.data_types import FloatTensorType

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        kw = {"split": split} if split else {}
        onx = onnxmltools.convert_lightgbm(
            model, initial_types=[("input", FloatTensorType([None, X_dim]))], zipmap=False, target_opset=15, **kw
        )
    return onx.SerializeToString()


ALL = [Linear, OrdinalLogistic, LgbmRegressor, LgbmOrdinal]


def grades_array() -> np.ndarray:
    return np.asarray(GRADES)
