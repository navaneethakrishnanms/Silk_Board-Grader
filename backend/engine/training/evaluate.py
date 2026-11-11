"""Evaluate a saved model (or the ISO baseline) on a features table.

    python -m training.evaluate --model training/out/m1_change.json --synthetic
    python -m training.evaluate --model training/out/m2_stain.json --table features.csv --split test

Metrics: exact agreement, within ±0.5, quadratic weighted kappa, MAE,
pass/fail agreement — for the model and the ISO baseline side by side.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from silkgrade_engine.model import FEATURE_NAMES, LinearJsonModel  # noqa: E402
from training.common import matrix, metrics, read_table, subset, synthetic_table  # noqa: E402


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--table")
    src.add_argument("--synthetic", action="store_true")
    ap.add_argument("--split", default=None, help="only rows whose 'split' column equals this")
    ap.add_argument("--required", type=float, default=None)
    ap.add_argument("--seed", type=int, default=1)
    a = ap.parse_args(argv)

    spec = json.loads(Path(a.model).read_text(encoding="utf-8"))
    m = LinearJsonModel(spec)
    rows = synthetic_table(seed=a.seed) if a.synthetic else read_table(a.table)
    rows = subset(rows, spec["name"])
    if a.split:
        rows = [r for r in rows if r.get("split") == a.split]
    X, y, _ = matrix(rows)
    pred = np.array([m.predict(dict(zip(FEATURE_NAMES, x)))[0] for x in X])
    req = a.required if a.required is not None else (4.0 if spec["name"] == "m1_change" else 3.5)
    out = {"model": f"{spec['name']}@{spec['version']}",
           "model_metrics": metrics(y, pred, req),
           "baseline_metrics": metrics(y, X[:, FEATURE_NAMES.index("iso_rating")], req)}
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
