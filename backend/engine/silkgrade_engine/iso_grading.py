"""ISO 105-A04 (staining) and ISO 105-A05 (colour change) rating formulas.

All constants come from ``config`` and are marked VERIFY there.
"""

from __future__ import annotations

import math

import numpy as np

from . import config


def stain_dE_gs(dE_ab: float, dL: float) -> float:
    """Grey-scale weighted staining difference (ISO 105-A04)."""
    return dE_ab - config.A04_CHROMA_WEIGHT * math.sqrt(max(dE_ab ** 2 - dL ** 2, 0.0))


def stain_rating_from_gs(dE_gs: float) -> float:
    if dE_gs <= 1e-6:
        return 5.0
    ssr = config.A04_LOG_INTERCEPT - config.A04_LOG_SLOPE * math.log(dE_gs)
    if ssr > config.A04_LINEAR_SWITCH:
        ssr = 5.0 - config.A04_LINEAR_SLOPE * dE_gs
    return min(max(ssr, 1.0), 5.0)


def stain_rating(dE_ab: float, dL: float) -> float:
    """Staining scale rating (SSR) from ΔE*ab and ΔL* — ISO 105-A04."""
    return stain_rating_from_gs(stain_dE_gs(dE_ab, dL))


def stain_dE_gs_array(dE_ab: np.ndarray, dL: np.ndarray) -> np.ndarray:
    return dE_ab - config.A04_CHROMA_WEIGHT * np.sqrt(np.maximum(dE_ab ** 2 - dL ** 2, 0.0))


def change_rating(dE_F: float) -> float:
    """Grey-scale colour change rating from ΔE_F — ISO 105-A05."""
    if dE_F <= config.A05_LINEAR_LIMIT:
        r = 5.0 - dE_F / config.A05_LINEAR_DIVISOR
    else:
        r = 5.0 - math.log(dE_F / config.A05_LOG_REF) / math.log(2.0)
    return min(max(r, 1.0), 5.0)


def half_grade(rating: float) -> float:
    # half-up rounding (Python's round() is banker's rounding: 8.5 -> 8)
    return min(max(math.floor(rating * 2.0 + 0.5) / 2.0, 1.0), 5.0)


def grade_label(rating: float) -> str:
    return config.GRADE_LABEL[half_grade(rating)]
