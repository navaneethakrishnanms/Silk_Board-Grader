"""Shared helpers for the training scripts (Section 10.3).

The real dataset comes from ``/export/dataset.zip`` (converted to a table by
``tools/export_dataset.py``). Until it exists, ``synthetic_table`` produces a
table with the same columns so the pipeline is proven end to end.
"""

from __future__ import annotations

import csv
import math
from pathlib import Path

import numpy as np

from silkgrade_engine import config
from silkgrade_engine.iso_grading import change_rating, half_grade, stain_rating
from silkgrade_engine.model import FEATURE_NAMES

CHANGE_KINDS = ("CHANGE_OVERALL", "CHANGE_GROUND", "CHANGE_MOTIF", "CHANGE_WORST")
STAIN_KINDS = ("STAIN_ADJ1", "STAIN_ADJ2", "STAIN_WORST")
TARGET = "label"           # consensus expert half-grade
GROUP = "test_id"          # split by test, never by image


def synthetic_table(n_tests: int = 600, seed: int = 0) -> list[dict]:
    """Simulated rows: features from random colour shifts, labels = what an
    assessor might say (ISO rating + a fibre/lightness-dependent bias + noise),
    rounded to half grades. Used only to prove the training pipeline."""
    rng = np.random.default_rng(seed)
    rows = []
    for t in range(n_tests):
        tid = f"synthetic-{t:05d}"
        # colour change row
        L0 = rng.uniform(20, 80)
        a0, b0 = rng.normal(0, 30, 2)
        dL, da, db = rng.normal(0, 1, 3) * rng.choice([0.3, 1, 2, 4, 7])
        dE = math.sqrt(dL * dL + da * da + db * db)
        iso = change_rating(dE * 0.9)
        bias = 0.15 * (L0 < 35) - 0.1 * (dE > 6)
        label = half_grade(iso + bias + rng.normal(0, 0.25))
        rows.append(_row(tid, "CHANGE_OVERALL", iso, dE, dL, L0, a0, b0, "silk", label, rng))
        # staining row
        fibre = rng.choice(["silk", "cotton"])
        sdL = -abs(rng.normal(0, 1)) * rng.choice([0.5, 2, 5, 10, 18])
        sdC = abs(rng.normal(0, 1)) * abs(sdL) * 0.6
        sdE = math.sqrt(sdL * sdL + sdC * sdC)
        siso = stain_rating(sdE, sdL)
        sbias = -0.2 if fibre == "cotton" else 0.0
        slabel = half_grade(siso + sbias + rng.normal(0, 0.25))
        rows.append(_row(tid, "STAIN_ADJ1", siso, sdE, sdL, 93.0, 0.0, 2.0, fibre, slabel, rng))
    return rows


def _row(tid, kind, iso, dE, dL, L0, a0, b0, fibre, label, rng) -> dict:
    p50 = dE * rng.uniform(0.9, 1.1)
    return {
        GROUP: tid, "kind": kind, TARGET: label,
        "iso_rating": iso, "dE_ab": dE, "dE00": dE * 0.8, "dE_F": dE * 0.8, "dL": dL,
        "dC": dE * 0.3, "dH": dE * 0.1, "p10": p50 * 0.6, "p50": p50, "p90": p50 * 1.5, "std": p50 * 0.3,
        "L_before": L0, "a_before": a0, "b_before": b0, "area_share": 1.0,
        "fibre_silk": 1.0 if fibre == "silk" else 0.0, "fibre_cotton": 1.0 if fibre == "cotton" else 0.0,
        "fabric_printed": 0.0, "n_warnings": 0.0,
    }


def read_table(path: str | Path) -> list[dict]:
    with open(path, newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    for r in rows:
        for k in FEATURE_NAMES + [TARGET]:
            if k in r and r[k] not in ("", None):
                r[k] = float(r[k])
    return [r for r in rows if r.get(TARGET) not in ("", None)]


def write_table(rows: list[dict], path: str | Path) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    cols = [GROUP, "kind", TARGET] + FEATURE_NAMES
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def subset(rows: list[dict], target: str) -> list[dict]:
    kinds = CHANGE_KINDS if target == "m1_change" else STAIN_KINDS
    return [r for r in rows if r["kind"] in kinds]


def matrix(rows: list[dict]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    X = np.array([[float(r.get(f, 0.0) or 0.0) for f in FEATURE_NAMES] for r in rows])
    y = np.array([float(r[TARGET]) for r in rows])
    g = np.array([r[GROUP] for r in rows])
    return X, y, g


def split_by_group(groups: np.ndarray, y: np.ndarray, seed: int = 0, frac=(0.70, 0.15, 0.15)):
    """70/15/15 split by test id, stratified by (rounded) grade of the group."""
    rng = np.random.default_rng(seed)
    uniq = {}
    for gi, yi in zip(groups, y):
        uniq.setdefault(gi, yi)
    by_grade: dict[float, list] = {}
    for gi, yi in uniq.items():
        by_grade.setdefault(yi, []).append(gi)
    assign = {}
    for _, gs in by_grade.items():
        rng.shuffle(gs)
        n = len(gs)
        n_tr, n_va = int(round(n * frac[0])), int(round(n * frac[1]))
        for i, gi in enumerate(gs):
            assign[gi] = "train" if i < n_tr else "val" if i < n_tr + n_va else "test"
    split = np.array([assign[gi] for gi in groups])
    return split


def metrics(y_true: np.ndarray, y_pred_rating: np.ndarray, required: float | None = None) -> dict:
    yt = np.asarray(y_true, dtype=float)
    yp = np.array([half_grade(v) for v in y_pred_rating])
    exact = float(np.mean(yt == yp))
    within = float(np.mean(np.abs(yt - yp) <= 0.5 + 1e-9))
    mae = float(np.mean(np.abs(yt - yp)))
    out = {"n": int(len(yt)), "exact": round(exact, 4), "within_half": round(within, 4),
           "mae": round(mae, 4), "qwk": round(quadratic_weighted_kappa(yt, yp), 4)}
    if required is not None:
        out["pass_fail_agreement"] = round(float(np.mean((yt >= required) == (yp >= required))), 4)
    return out


def quadratic_weighted_kappa(a: np.ndarray, b: np.ndarray) -> float:
    cats = config.GRADES
    k = len(cats)
    idx = {c: i for i, c in enumerate(cats)}
    O = np.zeros((k, k))
    for x, y in zip(a, b):
        O[idx[float(x)], idx[float(y)]] += 1
    if O.sum() == 0:
        return 0.0
    W = np.array([[(i - j) ** 2 / (k - 1) ** 2 for j in range(k)] for i in range(k)])
    E = np.outer(O.sum(1), O.sum(0)) / O.sum()
    denom = (W * E).sum()
    return float(1 - (W * O).sum() / denom) if denom else 1.0
