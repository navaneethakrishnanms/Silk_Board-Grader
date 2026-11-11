"""Metrics, calibration, review-threshold tuning, confusion matrices, breakdowns (WP6 steps 6-8)."""

from __future__ import annotations

from pathlib import Path

import numpy as np

from silkgrade_engine.config import GRADES
from silkgrade_engine.iso_grading import half_grade

REQUIRED = {"m1_change": 4.0, "m2_stain": 3.5}  # default pass/fail limits for the agreement metric


def to_half(r: np.ndarray) -> np.ndarray:
    return np.array([half_grade(float(v)) for v in r])


def qwk(a: np.ndarray, b: np.ndarray) -> float | None:
    cats = list(GRADES)
    k = len(cats)
    if len(a) == 0:
        return None
    O = np.zeros((k, k))
    for x, y in zip(a, b):
        O[cats.index(float(x)), cats.index(float(y))] += 1
    W = np.array([[(i - j) ** 2 / (k - 1) ** 2 for j in range(k)] for i in range(k)])
    E = np.outer(O.sum(1), O.sum(0)) / O.sum()
    den = (W * E).sum()
    return float(1 - (W * O).sum() / den) if den else 1.0


def metrics(y_true: np.ndarray, rating: np.ndarray, required: float | None = None, review: np.ndarray | None = None) -> dict:
    y = np.asarray(y_true, float)
    p = to_half(rating)
    out = {
        "n": int(len(y)),
        "exact": round(float(np.mean(y == p)), 4) if len(y) else None,
        "within_half": round(float(np.mean(np.abs(y - p) <= 0.5 + 1e-9)), 4) if len(y) else None,
        "qwk": None if len(y) == 0 else round(qwk(y, p), 4),
        "mae": round(float(np.mean(np.abs(y - p))), 4) if len(y) else None,
    }
    if required is not None and len(y):
        out["pass_fail_agreement"] = round(float(np.mean((y >= required) == (p >= required))), 4)
    if review is not None and len(y):
        out["review_rate"] = round(float(np.mean(review)), 4)
        auto = ~review
        out["auto_within_half"] = round(float(np.mean(np.abs(y[auto] - p[auto]) <= 0.5 + 1e-9)), 4) if auto.any() else None
    return out


def beats(model_m: dict, base_m: dict) -> bool:
    """Selection rule: higher weighted kappa than the ISO baseline, and ±0.5 agreement not lower."""
    if model_m["qwk"] is None or base_m["qwk"] is None:
        return False
    return model_m["qwk"] > base_m["qwk"] + 1e-9 and model_m["within_half"] >= base_m["within_half"] - 1e-9


def boundary_distance(r: np.ndarray) -> np.ndarray:
    return 0.25 - np.abs(((r - 1.25) % 0.5) - 0.25)


def calibrate_interval(rating: np.ndarray, y: np.ndarray, sigma: float, target: float = 0.95) -> dict:
    """Smallest z so that rating ± z·sigma contains the expert grade for >= target of validation records."""
    if sigma <= 0:
        sigma = 1e-3
    err = np.abs(np.asarray(y, float) - rating)

    def cover(z: float) -> float:
        return float(np.mean(err <= z * sigma + 1e-9))

    z = 1.96
    before = cover(z)
    zs = np.arange(0.5, 6.01, 0.01)
    ok = [zz for zz in zs if cover(zz) >= target]
    z_tuned = float(ok[0]) if ok else float(zs[-1])
    return {
        "sigma": round(sigma, 4),
        "coverage_at_1_96": round(before, 4),
        "z": round(z_tuned, 3),
        "coverage_tuned": round(cover(z_tuned), 4),
        "target": target,
    }


def tune_review_threshold(rating: np.ndarray, y: np.ndarray, max_review: float = 0.20, min_auto_within: float = 0.95) -> dict:
    """REVIEW when the prediction is within `margin` of a half-grade boundary. Choose the smallest
    margin whose auto-accepted results keep ±0.5 agreement >= min_auto_within, then check review rate."""
    y = np.asarray(y, float)
    p = to_half(rating)
    d = boundary_distance(rating)
    ok_within = np.abs(y - p) <= 0.5 + 1e-9
    best = None
    for m in np.round(np.arange(0.0, 0.2501, 0.01), 3):
        review = d < m
        auto = ~review
        aw = float(np.mean(ok_within[auto])) if auto.any() else 1.0
        rr = float(np.mean(review))
        if aw >= min_auto_within:
            best = {"margin": float(m), "review_rate": round(rr, 4), "auto_within_half": round(aw, 4)}
            break
    if best is None:
        best = {"margin": 0.25, "review_rate": 1.0, "auto_within_half": None}
    best["meets_review_target"] = best["review_rate"] <= max_review
    best["targets"] = {"max_review_rate": max_review, "min_auto_within_half": min_auto_within}
    return best


def confusion_png(y: np.ndarray, rating: np.ndarray, path: Path, title: str) -> str:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    cats = list(GRADES)
    p = to_half(rating)
    M = np.zeros((9, 9), int)
    for a, b in zip(y, p):
        M[cats.index(float(a)), cats.index(float(b))] += 1
    fig, ax = plt.subplots(figsize=(4.6, 4.2), dpi=110)
    ax.imshow(M, cmap="Greys")
    labels = ["1", "1-2", "2", "2-3", "3", "3-4", "4", "4-5", "5"]
    ax.set_xticks(range(9), labels, fontsize=7)
    ax.set_yticks(range(9), labels, fontsize=7)
    ax.set_xlabel("model grade")
    ax.set_ylabel("expert grade")
    ax.set_title(title, fontsize=8)
    for i in range(9):
        for j in range(9):
            if M[i, j]:
                ax.text(
                    j, i, str(M[i, j]), ha="center", va="center", fontsize=7, color="white" if M[i, j] > M.max() / 2 else "black"
                )
    fig.tight_layout()
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path)
    plt.close(fig)
    return str(path)


def breakdown(rows: list[dict], rating: np.ndarray, field: str, required: float) -> dict:
    out = {}
    for v in sorted({str(r[field]) for r in rows}):
        idx = np.array([str(r[field]) == v for r in rows])
        out[v] = metrics(np.array([r["label"] for r in rows])[idx], rating[idx], required)
    return out


def assessor_baseline(rows: list[dict], required: float) -> dict:
    """Assessor A vs B on the same records — the human agreement the model is compared with."""
    pairs = [
        (r["assessor_A"], r["assessor_B"]) for r in rows if r.get("assessor_A") is not None and r.get("assessor_B") is not None
    ]
    if not pairs:
        return {"n": 0}
    a = np.array([p[0] for p in pairs], float)
    b = np.array([p[1] for p in pairs], float)
    return metrics(a, b, required)
