"""Colour maths: sRGB -> linear -> XYZ (D65) -> CIELAB, ΔE*ab, ΔE00, ΔL ΔC ΔH.

Implemented with vectorised NumPy for speed; every function is tested against
``colour-science`` reference values in ``tests/test_colour.py``.
"""

from __future__ import annotations

import cv2
import numpy as np

from . import config

# CIE 1931 2° D65 white point (x=0.3127, y=0.3290), Y = 1
D65_XYZ = np.array([0.3127 / 0.3290, 1.0, (1.0 - 0.3127 - 0.3290) / 0.3290], dtype=np.float64)


def _rgb_to_xyz_matrix(primaries_xy, white_xyz) -> np.ndarray:
    """Normalised primary matrix from chromaticities (exact, not rounded)."""
    P = np.array([[x / y, 1.0, (1.0 - x - y) / y] for x, y in primaries_xy]).T
    S = np.linalg.solve(P, white_xyz)
    return P * S


# IEC 61966-2-1 normative sRGB -> XYZ matrix (4 decimals, as in the standard and
# in colour-science). The derived matrix is kept for reference/comparison.
M_SRGB_TO_XYZ = np.array([
    [0.4124, 0.3576, 0.1805],
    [0.2126, 0.7152, 0.0722],
    [0.0193, 0.1192, 0.9505],
], dtype=np.float64)
M_SRGB_TO_XYZ_DERIVED = _rgb_to_xyz_matrix([(0.64, 0.33), (0.30, 0.60), (0.15, 0.06)], D65_XYZ)
M_XYZ_TO_SRGB = np.linalg.inv(M_SRGB_TO_XYZ)

_EPS = 216.0 / 24389.0
_KAPPA = 24389.0 / 27.0


def srgb_to_linear(rgb: np.ndarray) -> np.ndarray:
    rgb = np.asarray(rgb, dtype=np.float64)
    return np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(lin: np.ndarray) -> np.ndarray:
    lin = np.clip(np.asarray(lin, dtype=np.float64), 0.0, None)
    return np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1.0 / 2.4) - 0.055)


def linear_to_xyz(lin: np.ndarray) -> np.ndarray:
    return np.asarray(lin, dtype=np.float64) @ M_SRGB_TO_XYZ.T


def xyz_to_linear(xyz: np.ndarray) -> np.ndarray:
    return np.asarray(xyz, dtype=np.float64) @ M_XYZ_TO_SRGB.T


def xyz_to_lab(xyz: np.ndarray, white: np.ndarray = D65_XYZ) -> np.ndarray:
    t = np.asarray(xyz, dtype=np.float64) / white
    f = np.where(t > _EPS, np.cbrt(t), (_KAPPA * t + 16.0) / 116.0)
    L = 116.0 * f[..., 1] - 16.0
    a = 500.0 * (f[..., 0] - f[..., 1])
    b = 200.0 * (f[..., 1] - f[..., 2])
    return np.stack([L, a, b], axis=-1)


def lab_to_xyz(lab: np.ndarray, white: np.ndarray = D65_XYZ) -> np.ndarray:
    lab = np.asarray(lab, dtype=np.float64)
    fy = (lab[..., 0] + 16.0) / 116.0
    fx = fy + lab[..., 1] / 500.0
    fz = fy - lab[..., 2] / 200.0

    def finv(f):
        f3 = f ** 3
        return np.where(f3 > _EPS, f3, (116.0 * f - 16.0) / _KAPPA)

    return np.stack([finv(fx), finv(fy), finv(fz)], axis=-1) * white


def _to_lab_fast(rgb: np.ndarray) -> np.ndarray:
    """float32 path for whole images (≈4x faster, error < 1e-3 ΔE)."""
    x = np.ascontiguousarray(rgb, dtype=np.float32)
    lin = np.empty_like(x)
    lo = x <= 0.04045
    lin[lo] = x[lo] / 12.92
    hi = ~lo
    lin[hi] = ((x[hi] + 0.055) / 1.055) ** 2.4
    M = (M_SRGB_TO_XYZ / D65_XYZ[:, None]).astype(np.float32)  # white-normalised
    t = lin.reshape(-1, 3) @ M.T
    f = np.where(t > _EPS, np.cbrt(t), (_KAPPA * t + 16.0) / 116.0).astype(np.float32)
    out = np.empty_like(t)
    out[:, 0] = 116.0 * f[:, 1] - 16.0
    out[:, 1] = 500.0 * (f[:, 0] - f[:, 1])
    out[:, 2] = 200.0 * (f[:, 1] - f[:, 2])
    return out.reshape(x.shape)


def to_lab(rgb: np.ndarray) -> np.ndarray:
    """sRGB-encoded (0..1) image or array -> CIELAB (D65). Returns float32."""
    rgb = np.asarray(rgb)
    if rgb.size > 30000:
        return _to_lab_fast(rgb)
    return xyz_to_lab(linear_to_xyz(srgb_to_linear(rgb))).astype(np.float32)


def lab_to_srgb(lab: np.ndarray) -> np.ndarray:
    return np.clip(linear_to_srgb(xyz_to_linear(lab_to_xyz(lab))), 0.0, 1.0)


def chroma(lab: np.ndarray) -> np.ndarray:
    lab = np.asarray(lab)
    return np.hypot(lab[..., 1], lab[..., 2])


def delta_e_ab(lab1: np.ndarray, lab2: np.ndarray) -> np.ndarray:
    d = np.asarray(lab1, dtype=np.float64) - np.asarray(lab2, dtype=np.float64)
    return np.sqrt(np.sum(d * d, axis=-1))


def delta_lch(lab_ref: np.ndarray, lab_test: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """ΔL, ΔC, ΔH (CIELAB, test minus reference). ΔH carries the hue-rotation sign."""
    r = np.asarray(lab_ref, dtype=np.float64)
    t = np.asarray(lab_test, dtype=np.float64)
    dL = t[..., 0] - r[..., 0]
    c_r = np.hypot(r[..., 1], r[..., 2])
    c_t = np.hypot(t[..., 1], t[..., 2])
    dC = c_t - c_r
    da = t[..., 1] - r[..., 1]
    db = t[..., 2] - r[..., 2]
    dH2 = np.maximum(da * da + db * db - dC * dC, 0.0)
    sign = np.sign(r[..., 1] * t[..., 2] - r[..., 2] * t[..., 1])
    sign = np.where(sign == 0, 1.0, sign)
    return dL, dC, sign * np.sqrt(dH2)


def delta_e_2000(lab1: np.ndarray, lab2: np.ndarray, kL: float = 1.0, kC: float = 1.0, kH: float = 1.0) -> np.ndarray:
    """CIEDE2000 (Sharma, Wu, Dalal 2005), vectorised."""
    l1 = np.asarray(lab1, dtype=np.float64)
    l2 = np.asarray(lab2, dtype=np.float64)
    L1, a1, b1 = l1[..., 0], l1[..., 1], l1[..., 2]
    L2, a2, b2 = l2[..., 0], l2[..., 1], l2[..., 2]

    C1 = np.hypot(a1, b1)
    C2 = np.hypot(a2, b2)
    Cbar = (C1 + C2) / 2.0
    Cbar7 = Cbar ** 7
    G = 0.5 * (1.0 - np.sqrt(Cbar7 / (Cbar7 + 25.0 ** 7)))
    a1p = (1.0 + G) * a1
    a2p = (1.0 + G) * a2
    C1p = np.hypot(a1p, b1)
    C2p = np.hypot(a2p, b2)
    h1p = np.degrees(np.arctan2(b1, a1p)) % 360.0
    h2p = np.degrees(np.arctan2(b2, a2p)) % 360.0

    dLp = L2 - L1
    dCp = C2p - C1p
    dhp = h2p - h1p
    dhp = np.where(dhp > 180.0, dhp - 360.0, dhp)
    dhp = np.where(dhp < -180.0, dhp + 360.0, dhp)
    dhp = np.where(C1p * C2p == 0, 0.0, dhp)
    dHp = 2.0 * np.sqrt(C1p * C2p) * np.sin(np.radians(dhp) / 2.0)

    Lbarp = (L1 + L2) / 2.0
    Cbarp = (C1p + C2p) / 2.0
    hsum = h1p + h2p
    hbarp = np.where(np.abs(h1p - h2p) > 180.0,
                     np.where(hsum < 360.0, (hsum + 360.0) / 2.0, (hsum - 360.0) / 2.0),
                     hsum / 2.0)
    hbarp = np.where(C1p * C2p == 0, hsum, hbarp)

    T = (1.0 - 0.17 * np.cos(np.radians(hbarp - 30.0))
         + 0.24 * np.cos(np.radians(2.0 * hbarp))
         + 0.32 * np.cos(np.radians(3.0 * hbarp + 6.0))
         - 0.20 * np.cos(np.radians(4.0 * hbarp - 63.0)))
    dtheta = 30.0 * np.exp(-(((hbarp - 275.0) / 25.0) ** 2))
    Cbarp7 = Cbarp ** 7
    RC = 2.0 * np.sqrt(Cbarp7 / (Cbarp7 + 25.0 ** 7))
    SL = 1.0 + (0.015 * (Lbarp - 50.0) ** 2) / np.sqrt(20.0 + (Lbarp - 50.0) ** 2)
    SC = 1.0 + 0.045 * Cbarp
    SH = 1.0 + 0.015 * Cbarp * T
    RT = -np.sin(np.radians(2.0 * dtheta)) * RC

    tL = dLp / (kL * SL)
    tC = dCp / (kC * SC)
    tH = dHp / (kH * SH)
    return np.sqrt(tL * tL + tC * tC + tH * tH + RT * tC * tH)


def delta_e_f(lab_ref: np.ndarray, lab_test: np.ndarray) -> tuple[np.ndarray, bool]:
    """ISO 105-A05 weighted colour difference ΔE_F.

    Returns (value, is_placeholder).

    TODO VERIFY: implement the ISO 105-A05 ΔE_F definition exactly as written in
    the purchased standard. Until then CIEDE2000 is used as a placeholder and
    ``is_placeholder`` is True, which makes the UI show a "provisional" badge
    and forces the grade to REVIEW.
    """
    value = delta_e_2000(lab_ref, lab_test)
    return value, not config.DE_F_VERIFIED


def smooth(img: np.ndarray, sigma_px: float) -> np.ndarray:
    """Gaussian texture averaging (sigma ≈ 1 mm in pixels)."""
    if sigma_px <= 0.3:
        return img
    return cv2.GaussianBlur(img.astype(np.float32), (0, 0), sigmaX=float(sigma_px), sigmaY=float(sigma_px))
