"""Before/after alignment of the specimen: AKAZE features + RANSAC homography."""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from . import config


@dataclass
class Registration:
    ok: bool
    method: str
    inliers: int
    H: np.ndarray | None          # maps AFTER pixel coords -> BEFORE pixel coords
    message: str = ""

    def as_dict(self) -> dict:
        return {"method": self.method, "inliers": int(self.inliers), "ok": bool(self.ok),
                "message": self.message}


def _grey_u8(rgb: np.ndarray, mask: np.ndarray | None) -> tuple[np.ndarray, np.ndarray | None]:
    g = cv2.cvtColor(np.clip(rgb * 255.0, 0, 255).astype(np.uint8), cv2.COLOR_RGB2GRAY)
    # local contrast normalisation makes matching robust to the colour change
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    g = clahe.apply(g)
    m = mask.astype(np.uint8) * 255 if mask is not None else None
    return g, m


def _detector():
    """AKAZE (spec) when available; OpenCV 5 moved it to contrib, so fall back
    to SIFT, then ORB. The method actually used is reported in the response."""
    if config.REGISTRATION_METHOD == "AKAZE" and hasattr(cv2, "AKAZE_create"):
        return "AKAZE", cv2.AKAZE_create(threshold=0.0005), cv2.NORM_HAMMING
    if hasattr(cv2, "SIFT_create"):
        return "SIFT", cv2.SIFT_create(nfeatures=4000), cv2.NORM_L2
    return "ORB", cv2.ORB_create(nfeatures=4000), cv2.NORM_HAMMING


def align(before_rgb: np.ndarray, after_rgb: np.ndarray,
          before_mask: np.ndarray | None = None, after_mask: np.ndarray | None = None) -> Registration:
    gb, mb = _grey_u8(before_rgb, before_mask)
    ga, ma = _grey_u8(after_rgb, after_mask)
    method, det, norm = _detector()
    kb, db = det.detectAndCompute(gb, mb)
    ka, da = det.detectAndCompute(ga, ma)
    if db is None or da is None or len(kb) < 8 or len(ka) < 8:
        return Registration(False, method, 0, None, "too few features")

    matcher = cv2.BFMatcher(norm)
    raw = matcher.knnMatch(da, db, k=2)
    good = [m for m, n in (p for p in raw if len(p) == 2) if m.distance < 0.8 * n.distance]
    if len(good) < 8:
        return Registration(False, method, len(good), None, "too few matches")

    src = np.float32([ka[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    dst = np.float32([kb[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
    H, inl = cv2.findHomography(src, dst, cv2.RANSAC, config.RANSAC_REPROJ_PX)
    n_in = int(inl.sum()) if inl is not None else 0
    if H is None or n_in < config.MIN_INLIERS:
        return Registration(False, method, n_in, None, "too few inliers")
    # reject degenerate warps (strong perspective / scale change)
    det_a = np.linalg.det(H[:2, :2])
    if not (0.5 < det_a < 2.0) or abs(H[2, 0]) > 1e-2 or abs(H[2, 1]) > 1e-2:
        return Registration(False, method, n_in, None, "degenerate homography")
    return Registration(True, method, n_in, H, "")


def from_points(before_pts: list[list[float]], after_pts: list[list[float]]) -> Registration:
    """Manual fallback: the tester taps 2 matching points -> similarity transform."""
    if len(before_pts) < 2 or len(after_pts) < 2:
        return Registration(False, "MANUAL", 0, None, "need 2 points")
    A, _ = cv2.estimateAffinePartial2D(np.float32(after_pts), np.float32(before_pts))
    if A is None:
        return Registration(False, "MANUAL", 0, None, "bad points")
    H = np.vstack([A, [0, 0, 1]])
    return Registration(True, "MANUAL", len(before_pts), H, "")


def warp_to_before(img: np.ndarray, H: np.ndarray, shape: tuple[int, int], nearest: bool = False) -> np.ndarray:
    h, w = shape
    interp = cv2.INTER_NEAREST if nearest else cv2.INTER_LINEAR
    src = img.astype(np.uint8) if img.dtype == bool else img
    out = cv2.warpPerspective(src, H, (w, h), flags=interp, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    return out.astype(bool) if img.dtype == bool else out


def scale_homography(H: np.ndarray, s_after: float, s_before: float) -> np.ndarray:
    """Convert H between full-res and analysis-scale coordinates."""
    Sa = np.diag([s_after, s_after, 1.0])
    Sb = np.diag([s_before, s_before, 1.0])
    return Sb @ H @ np.linalg.inv(Sa)
