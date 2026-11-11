"""Per-region colour-difference features."""

from __future__ import annotations

import numpy as np

from . import config
from .colour import delta_e_2000, delta_e_ab, delta_e_f, delta_lch
from .iso_grading import stain_dE_gs, stain_dE_gs_array


def _r(x: float, nd: int = 4) -> float:
    return float(round(float(x), nd))


def _lab_dict(lab: np.ndarray) -> list[float]:
    return [_r(v, 3) for v in lab]


def change_features(lab_before: np.ndarray, lab_after: np.ndarray, mask: np.ndarray,
                    total_valid_px: int | None = None,
                    de_map: np.ndarray | None = None) -> tuple[dict, np.ndarray]:
    """Colour change on pixel-registered before/after images.

    Returns (features, per-pixel ΔE00 map with NaN outside mask).
    """
    pb = lab_before[mask].astype(np.float64)
    pa = lab_after[mask].astype(np.float64)
    mb = np.median(pb, axis=0)
    ma = np.median(pa, axis=0)
    dE_ab = float(delta_e_ab(mb, ma))
    dE00 = float(delta_e_2000(mb, ma))
    dE_F, placeholder = delta_e_f(mb, ma)
    dL, dC, dH = (float(v) for v in delta_lch(mb, ma))
    if de_map is not None:  # reuse a per-pixel map computed on a superset mask
        per_px = de_map[mask].astype(np.float64)
        emap = de_map
    else:
        per_px = delta_e_2000(pb, pa)
        emap = np.full(mask.shape, np.nan, dtype=np.float32)
        emap[mask] = per_px
    p10, p50, p90 = np.percentile(per_px, [10, 50, 90])
    feats = {
        "lab_before": _lab_dict(mb), "lab_after": _lab_dict(ma),
        "dE_ab": _r(dE_ab), "dE00": _r(dE00), "dE_F": _r(float(dE_F)),
        "dE_F_is_placeholder": bool(placeholder),
        "dL": _r(dL), "dC": _r(dC), "dH": _r(dH),
        "p10": _r(p10), "p50": _r(p50), "p90": _r(p90), "std": _r(per_px.std()),
        "area_share": _r(mask.sum() / max(1, total_valid_px or mask.sum())),
        "valid_px": int(mask.sum()),
    }
    return feats, emap


def _tile_medians(lab: np.ndarray, mask: np.ndarray, grid: int) -> np.ndarray:
    ys, xs = np.nonzero(mask)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    yb = np.linspace(y0, y1, grid + 1).astype(int)
    xb = np.linspace(x0, x1, grid + 1).astype(int)
    meds = []
    min_px = max(20, int(mask.sum() / (grid * grid) * 0.25))
    for i in range(grid):
        for j in range(grid):
            m = mask[yb[i]:yb[i + 1], xb[j]:xb[j + 1]]
            if m.sum() >= min_px:
                meds.append(np.median(lab[yb[i]:yb[i + 1], xb[j]:xb[j + 1]][m], axis=0))
    return np.asarray(meds) if meds else np.median(lab[mask], axis=0, keepdims=True)


def stain_features(lab_before: np.ndarray, mask_before: np.ndarray,
                   lab_after: np.ndarray, mask_after: np.ndarray) -> tuple[dict, np.ndarray]:
    """Staining: unwashed vs washed adjacent fabric (separate pieces, not registered).

    * median statistic: ΔE between the median colours.
    * p90 statistic ("most-stained area"): 90th percentile of the grey-scale
      staining difference over tile medians of the washed piece, against the
      unwashed median. Tiles suppress pixel noise so a clean fabric stays at 5.

    Returns (features, per-pixel ΔE*ab map of the AFTER image).
    """
    pb = lab_before[mask_before].astype(np.float64)
    pa = lab_after[mask_after].astype(np.float64)
    mb = np.median(pb, axis=0)
    ma = np.median(pa, axis=0)
    dE_ab = float(delta_e_ab(mb, ma))
    dE00 = float(delta_e_2000(mb, ma))
    dL, dC, dH = (float(v) for v in delta_lch(mb, ma))

    tiles = _tile_medians(lab_after, mask_after, config.STAIN_TILE_GRID)
    t_dE = delta_e_ab(tiles, mb[None, :])
    t_dL = tiles[:, 0] - mb[0]
    t_gs = stain_dE_gs_array(t_dE, t_dL)
    i90 = int(np.argsort(t_gs)[min(len(t_gs) - 1, int(np.ceil(0.9 * len(t_gs))) - 1)]) if len(t_gs) else 0
    gs_p90 = float(np.percentile(t_gs, 90)) if len(t_gs) else 0.0

    per_px = delta_e_ab(pa, mb[None, :])
    p10, p50, p90 = np.percentile(per_px, [10, 50, 90])
    emap = np.full(mask_after.shape, np.nan, dtype=np.float32)
    emap[mask_after] = per_px

    feats = {
        "lab_before": _lab_dict(mb), "lab_after": _lab_dict(ma),
        "dE_ab": _r(dE_ab), "dE00": _r(dE00), "dL": _r(dL), "dC": _r(dC), "dH": _r(dH),
        "dE_gs_median": _r(stain_dE_gs(dE_ab, dL)),
        "dE_gs_p90": _r(gs_p90),
        "dE_ab_p90_tile": _r(float(t_dE[i90]) if len(t_dE) else 0.0),
        "p10": _r(p10), "p50": _r(p50), "p90": _r(p90), "std": _r(per_px.std()),
        "area_share": 1.0,
        "valid_px_before": int(mask_before.sum()), "valid_px_after": int(mask_after.sum()),
    }
    return feats, emap
