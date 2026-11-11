"""Image quality checks: blur, clipping, glare, low resolution."""

from __future__ import annotations

import cv2
import numpy as np

from . import config
from .colour import chroma


def blur_score(rgb: np.ndarray, mask: np.ndarray | None = None) -> float:
    """Variance of the Laplacian of 8-bit luminance (higher = sharper)."""
    grey = cv2.cvtColor(np.clip(rgb * 255.0, 0, 255).astype(np.uint8), cv2.COLOR_RGB2GRAY)
    lap = cv2.Laplacian(grey, cv2.CV_64F)
    if mask is not None and mask.any():
        m = cv2.erode(mask.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
        if m.sum() > 100:
            return float(lap[m].var())
    return float(lap.var())


def clipping_fraction(rgb: np.ndarray, mask: np.ndarray | None = None) -> float:
    clipped = np.any(rgb >= config.CLIP_LEVEL, axis=-1)
    if mask is not None and mask.any():
        return float(clipped[mask].mean())
    return float(clipped.mean())


def glare_mask(lab: np.ndarray, mask: np.ndarray | None = None) -> np.ndarray:
    """Connected blobs with L* > GLARE_L_MIN and C* < GLARE_C_MAX inside fabric."""
    g = (lab[..., 0] > config.GLARE_L_MIN) & (chroma(lab) < config.GLARE_C_MAX)
    if mask is not None:
        g &= mask
    if not g.any():
        return g
    n, labels, stats, _ = cv2.connectedComponentsWithStats(g.astype(np.uint8), connectivity=8)
    area_ref = float(mask.sum()) if mask is not None and mask.any() else float(g.size)
    min_area = max(4, int(config.GLARE_MIN_BLOB_FRACTION * area_ref))
    keep = np.zeros(n, dtype=bool)
    keep[1:] = stats[1:, cv2.CC_STAT_AREA] >= min_area
    return keep[labels]


def check(rgb: np.ndarray, lab: np.ndarray, mask: np.ndarray | None = None,
          full_res_area_px: float | None = None, expect_white: bool = False) -> dict:
    """Run all checks on a (downscaled) image region.

    ``full_res_area_px`` is the fabric area at original resolution, used for the
    low-resolution check. ``expect_white``: glare on a white adjacent fabric is
    indistinguishable from the fabric itself, so it is only checked via clipping.
    """
    region = mask if mask is not None else np.ones(rgb.shape[:2], dtype=bool)
    blur = blur_score(rgb, region)
    clip = clipping_fraction(rgb, region)
    glare = glare_mask(lab, region) if not expect_white else np.zeros_like(region)
    glare_share = float(glare.sum()) / max(1.0, float(region.sum()))
    area_px = full_res_area_px if full_res_area_px is not None else float(region.sum())
    mp = area_px / 1e6

    warnings = {
        "blur": bool(blur < config.BLUR_MIN),
        "clipping": bool(clip > config.CLIP_MAX_FRACTION),
        "glare": bool(glare_share > config.GLARE_MIN_BLOB_FRACTION),
        "lowRes": bool(mp < config.LOW_RES_MIN_MP),
    }
    metrics = {"blur_var": round(blur, 2), "clipped_fraction": round(clip, 5),
               "glare_fraction": round(glare_share, 5), "region_mp": round(mp, 3)}
    return {"warnings": warnings, "metrics": metrics, "glare_mask": glare}
