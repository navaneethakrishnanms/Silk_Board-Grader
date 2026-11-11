"""Optional colour-reference-card correction (24-patch colour checker).

The card region is given as a 4-point polygon (corners in order: top-left,
top-right, bottom-right, bottom-left of the patch grid). Patches are sampled,
a 3x3 (or root-polynomial) matrix is fitted in linear RGB from measured patch
values to their reference values, and applied to the whole image.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from . import config
from .colour import delta_e_2000, linear_to_srgb, srgb_to_linear, to_lab

# Reference sRGB (D65) 8-bit values of the 24-patch colour checker, row-major.
# TODO VERIFY against the certificate of the client's physical card.
REFERENCE_SRGB_U8 = np.array([
    [115, 82, 68], [194, 150, 130], [98, 122, 157], [87, 108, 67], [133, 128, 177], [103, 189, 170],
    [214, 126, 44], [80, 91, 166], [193, 90, 99], [94, 60, 108], [157, 188, 64], [224, 163, 46],
    [56, 61, 150], [70, 148, 73], [175, 54, 60], [231, 199, 31], [187, 86, 149], [8, 133, 161],
    [243, 243, 242], [200, 200, 200], [160, 160, 160], [122, 122, 121], [85, 85, 85], [52, 52, 52],
], dtype=np.float64)


@dataclass
class CardCorrection:
    matrix: np.ndarray
    method: str
    residual_de00: float
    patches_measured: np.ndarray

    def as_dict(self) -> dict:
        return {"method": self.method, "residual_dE00": round(self.residual_de00, 3)}


def sample_patches(rgb: np.ndarray, quad: list[list[float]], grid=config.REF_CARD_GRID) -> np.ndarray:
    cols, rows = grid
    W, H = cols * 60, rows * 60
    src = np.float32(quad[:4])
    dst = np.float32([[0, 0], [W, 0], [W, H], [0, H]])
    M = cv2.getPerspectiveTransform(src, dst)
    flat = cv2.warpPerspective(rgb.astype(np.float32), M, (W, H), flags=cv2.INTER_AREA)
    half = int(30 * config.REF_CARD_PATCH_FRACTION)
    out = []
    for r in range(rows):
        for c in range(cols):
            cy, cx = r * 60 + 30, c * 60 + 30
            out.append(np.median(flat[cy - half:cy + half, cx - half:cx + half].reshape(-1, 3), axis=0))
    return np.asarray(out)


def _expand(lin: np.ndarray, method: str) -> np.ndarray:
    if method == "root_poly2":
        r, g, b = lin[..., 0], lin[..., 1], lin[..., 2]
        return np.stack([r, g, b, np.sqrt(np.abs(r * g)), np.sqrt(np.abs(g * b)), np.sqrt(np.abs(r * b))], axis=-1)
    return lin


def fit(measured_srgb: np.ndarray, method: str = "linear3x3") -> CardCorrection:
    ref_srgb = REFERENCE_SRGB_U8 / 255.0
    best = None
    for patches in (measured_srgb, measured_srgb[::-1]):  # card may be upside down
        X = _expand(srgb_to_linear(patches), method)
        Y = srgb_to_linear(ref_srgb)
        M, *_ = np.linalg.lstsq(X, Y, rcond=None)
        pred = linear_to_srgb(X @ M)
        res = float(np.mean(delta_e_2000(to_lab(pred), to_lab(ref_srgb))))
        if best is None or res < best.residual_de00:
            best = CardCorrection(M, method, res, patches)
    return best


def apply(rgb: np.ndarray, corr: CardCorrection) -> np.ndarray:
    lin = srgb_to_linear(rgb)
    out = _expand(lin, corr.method) @ corr.matrix
    return np.clip(linear_to_srgb(out), 0.0, 1.0).astype(np.float32)


def correct(
    rgb: np.ndarray, quad: list[list[float]] | None, method: str = "linear3x3"
) -> tuple[np.ndarray, CardCorrection | None]:
    if not quad or len(quad) < 4:
        return rgb, None
    corr = fit(sample_patches(rgb, quad), method)
    return apply(rgb, corr), corr
