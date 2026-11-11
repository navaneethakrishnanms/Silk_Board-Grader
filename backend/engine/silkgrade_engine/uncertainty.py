"""Bootstrap uncertainty interval for a rating (Section 8.5)."""

from __future__ import annotations

from typing import Callable

import numpy as np

from . import config

POOL_MAX = 60000  # valid pixels kept (uniformly) as the bootstrap pool


def _pool(mask: np.ndarray, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
    ys, xs = np.nonzero(mask)
    if ys.size > POOL_MAX:
        idx = rng.choice(ys.size, POOL_MAX, replace=False)
        ys, xs = ys[idx], xs[idx]
    return ys, xs


def _window_indices(ys: np.ndarray, xs: np.ndarray, frac: float, rng: np.random.Generator) -> np.ndarray:
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    hh, ww = y1 - y0, x1 - x0
    s = np.sqrt(frac)
    wh, wy = max(2, int(hh * s)), max(2, int(ww * s))
    for _ in range(8):
        oy = rng.integers(y0, max(y0 + 1, y1 - wh + 1))
        ox = rng.integers(x0, max(x0 + 1, x1 - wy + 1))
        sel = np.nonzero((ys >= oy) & (ys < oy + wh) & (xs >= ox) & (xs < ox + wy))[0]
        if sel.size >= 30:
            break
    if sel.size > config.BOOTSTRAP_MAX_PIXELS:
        sel = rng.choice(sel, config.BOOTSTRAP_MAX_PIXELS, replace=False)
    return sel


def bootstrap_paired(lab_before: np.ndarray, lab_after: np.ndarray, mask: np.ndarray,
                     rate: Callable[[np.ndarray, np.ndarray], float],
                     n: int = config.BOOTSTRAP_N, frac: float = config.BOOTSTRAP_PATCH_FRACTION,
                     seed: int = config.BOOTSTRAP_SEED) -> np.ndarray:
    """Registered pair: the same sub-patch is taken from both images.
    ``rate(median_before, median_after) -> rating``."""
    rng = np.random.default_rng(seed)
    ys, xs = _pool(mask, rng)
    if ys.size < 50:
        return np.array([])
    out = np.empty(n)
    for i in range(n):
        sel = _window_indices(ys, xs, frac, rng)
        yy, xx = ys[sel], xs[sel]
        out[i] = rate(np.median(lab_before[yy, xx], axis=0), np.median(lab_after[yy, xx], axis=0))
    return out


def bootstrap_independent(lab_before: np.ndarray, mask_before: np.ndarray,
                          lab_after: np.ndarray, mask_after: np.ndarray,
                          rate: Callable[[np.ndarray, np.ndarray], float],
                          n: int = config.BOOTSTRAP_N, frac: float = config.BOOTSTRAP_PATCH_FRACTION,
                          seed: int = config.BOOTSTRAP_SEED) -> np.ndarray:
    """Unregistered pieces (staining): sub-patches drawn independently."""
    rng = np.random.default_rng(seed)
    yb, xb = _pool(mask_before, rng)
    ya, xa = _pool(mask_after, rng)
    if yb.size < 50 or ya.size < 50:
        return np.array([])
    out = np.empty(n)
    for i in range(n):
        sb = _window_indices(yb, xb, frac, rng)
        sa = _window_indices(ya, xa, frac, rng)
        out[i] = rate(np.median(lab_before[yb[sb], xb[sb]], axis=0),
                      np.median(lab_after[ya[sa], xa[sa]], axis=0))
    return out


def interval(final_rating: float, boot: np.ndarray, n_warnings: int = 0,
             ref_residual_de00: float | None = None) -> dict:
    """95 % interval centred on the final rating, widened by warnings and the
    reference-card residual; confidence from the interval width."""
    if boot.size:
        lo, med, hi = np.percentile(boot, [2.5, 50, 97.5])
        offset = final_rating - med
        lo, hi = lo + offset, hi + offset
    else:
        lo = hi = final_rating
        n_warnings += 2  # no bootstrap possible -> treat as uncertain
    widen = config.WARNING_CI_PENALTY * n_warnings
    if ref_residual_de00:
        widen += config.REF_RESIDUAL_GRADE_PER_DE * float(ref_residual_de00)
    lo = max(1.0, min(lo, final_rating) - widen)
    hi = min(5.0, max(hi, final_rating) + widen)
    width = hi - lo
    if width <= config.CI_HIGH_MAX_WIDTH:
        conf = "HIGH"
    elif width <= config.CI_MEDIUM_MAX_WIDTH:
        conf = "MEDIUM"
    else:
        conf = "LOW"
    return {"ci": [round(float(lo), 3), round(float(hi), 3)], "confidence": conf,
            "width": round(float(width), 3)}


def crosses_half_grade_boundary(ci: list[float]) -> bool:
    """True if the interval spans a rounding boundary (x.25 or x.75)."""
    lo, hi = ci
    from .iso_grading import half_grade

    return half_grade(lo) != half_grade(hi)
