"""Train M1 (colour change) / M2 (staining) correction models.

    python -m training.train --target m1_change --synthetic --out training/out
    python -m training.train --target m2_stain  --table dataset_features.csv --out training/out

Baseline = ISO formula. Candidate = ridge regression on the flat feature vector
(ordinal logistic regression via ``mord`` or LightGBM can be dropped in later:
keep the simplest model that beats the baseline). The model is saved only if it
beats the baseline on the validation split, as JSON coefficients that
``silkgrade_engine.model.LinearJsonModel`` loads.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from sklearn.linear_model import Ridge
from sklearn.model_selection import GroupKFold
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from silkgrade_engine.model import FEATURE_NAMES  # noqa: E402
from training.common import matrix, metrics, read_table, split_by_group, subset, synthetic_table, write_table  # noqa: E402


def fit(X: np.ndarray, y: np.ndarray, alpha: float = 1.0):
    scaler = StandardScaler().fit(X)
    reg = Ridge(alpha=alpha).fit(scaler.transform(X), y)
    return scaler, reg


def predict(scaler, reg, X):
    return np.clip(reg.predict(scaler.transform(X)), 1.0, 5.0)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", choices=["m1_change", "m2_stain"], required=True)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--table", help="features CSV from tools/export_dataset.py")
    src.add_argument("--synthetic", action="store_true", help="prove the pipeline on simulated data")
    ap.add_argument("--out", default="training/out")
    ap.add_argument("--version", default=None)
    ap.add_argument("--alpha", type=float, default=1.0)
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args(argv)

    rows = synthetic_table(seed=a.seed) if a.synthetic else read_table(a.table)
    rows = subset(rows, a.target)
    if len(rows) < 30:
        print(f"not enough labelled rows for {a.target}: {len(rows)}")
        return 2
    X, y, groups = matrix(rows)
    split = split_by_group(groups, y, a.seed)
    tr, va, te = split == "train", split == "val", split == "test"
    iso_idx = FEATURE_NAMES.index("iso_rating")

    # 5-fold grouped CV on train (small data)
    cv = []
    for f_tr, f_va in GroupKFold(n_splits=5).split(X[tr], y[tr], groups[tr]):
        s, r = fit(X[tr][f_tr], y[tr][f_tr], a.alpha)
        cv.append(metrics(y[tr][f_va], predict(s, r, X[tr][f_va]))["within_half"])

    scaler, reg = fit(X[tr], y[tr], a.alpha)
    res_std = float(np.std(y[tr] - predict(scaler, reg, X[tr])))
    result = {
        "baseline_val": metrics(y[va], X[va][:, iso_idx]),
        "model_val": metrics(y[va], predict(scaler, reg, X[va])),
        "baseline_test": metrics(y[te], X[te][:, iso_idx]),
        "model_test": metrics(y[te], predict(scaler, reg, X[te])),
        "cv_within_half_mean": round(float(np.mean(cv)), 4),
        "n_train": int(tr.sum()), "n_val": int(va.sum()), "n_test": int(te.sum()),
    }
    beats = (result["model_val"]["within_half"] >= result["baseline_val"]["within_half"]
             and result["model_val"]["mae"] < result["baseline_val"]["mae"])
    print(json.dumps(result, indent=2))

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    write_table([dict(r, split=s) for r, s in zip(rows, split)], out / f"{a.target}_splits.csv")
    if not beats:
        print("model does NOT beat the ISO baseline on validation -> not saved (stay formula-only)")
        return 1
    version = a.version or datetime.now(timezone.utc).strftime("%Y.%m.%d-%H%M") + ("-synthetic" if a.synthetic else "")
    spec = {
        "name": a.target, "version": version, "type": "linear",
        "features": FEATURE_NAMES,
        "coef": [round(float(c), 8) for c in reg.coef_],
        "intercept": round(float(reg.intercept_), 8),
        "scaler_mean": [round(float(m), 8) for m in scaler.mean_],
        "scaler_scale": [round(float(s), 8) for s in scaler.scale_],
        "residual_std": round(res_std, 4),
        "trained_on": "synthetic" if a.synthetic else str(a.table),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    (out / f"{a.target}.json").write_text(json.dumps(spec, indent=2), encoding="utf-8")
    (out / f"{a.target}_metrics.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(f"saved {out / (a.target + '.json')} version {version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
