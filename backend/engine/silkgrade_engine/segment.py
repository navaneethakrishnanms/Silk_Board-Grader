"""Fabric segmentation inside confirmed polygons: fabric mask, edge erosion,
seam masking, glare masking, and auto region detection."""

from __future__ import annotations

import math

import cv2
import numpy as np

from . import config
from .colour import chroma


def polygon_mask(shape: tuple[int, int], polygon: list[list[float]] | None, scale: float = 1.0) -> np.ndarray:
    h, w = shape
    if not polygon or len(polygon) < 3:
        return np.ones((h, w), dtype=bool)
    pts = np.round(np.asarray(polygon, dtype=np.float64) * scale).astype(np.int32)
    m = np.zeros((h, w), dtype=np.uint8)
    cv2.fillPoly(m, [pts], 1)
    return m.astype(bool)


def px_per_mm(
    mask: np.ndarray, nominal_mm: tuple[float, float] = config.SPECIMEN_NOMINAL_MM, dpi: float | None = None, scale: float = 1.0
) -> float:
    """Pixels per millimetre: from DPI when known, else from the polygon area
    assuming the nominal composite piece size."""
    if dpi and dpi > 30:
        return dpi / 25.4 * scale
    area = float(mask.sum())
    return max(math.sqrt(area / (nominal_mm[0] * nominal_mm[1])), 0.5)


def _paper_stats(lab: np.ndarray, ref: np.ndarray) -> tuple[float, float, float]:
    """(paper L*, paper L* noise, paper texture) from reference pixels (border or ring)."""
    L = lab[..., 0].astype(np.float32)
    tex = _local_std(L)
    return float(np.median(L[ref])), float(np.std(L[ref])), float(np.median(tex[ref]))


def _local_std(L: np.ndarray, s: float = config.WHITE_BG_TEXTURE_SIGMA) -> np.ndarray:
    mean = cv2.GaussianBlur(L, (0, 0), s)
    sq = cv2.GaussianBlur(L * L, (0, 0), s)
    return np.sqrt(np.maximum(sq - mean * mean, 0))


def white_paper_foreground(lab: np.ndarray, ref: np.ndarray) -> np.ndarray:
    """Fabric on WHITE paper: colour distance cannot separate a white strip from the page, so a
    pixel is fabric when (a) its weave texture is clearly above the paper's, (b) it is darker than
    the paper beyond the paper's own noise, or (c) it is coloured. Thresholds adapt to the paper
    measured at `ref` (image border or a ring around a polygon)."""
    L = lab[..., 0].astype(np.float32)
    paper_L, paper_noise, paper_tex = _paper_stats(lab, ref)
    tex = cv2.GaussianBlur(_local_std(L), (0, 0), config.WHITE_BG_TEXTURE_SIGMA)
    tex_thr = max(config.WHITE_BG_TEXTURE_FLOOR, config.WHITE_BG_TEXTURE_FACTOR * paper_tex)
    dl_thr = max(config.WHITE_BG_DL_FLOOR, config.WHITE_BG_DL_FACTOR * paper_noise)
    C = chroma(lab).astype(np.float32)
    darker = cv2.GaussianBlur(L, (0, 0), 3.0) < paper_L - dl_thr
    coloured = cv2.GaussianBlur(C, (0, 0), 2.0) > 6.0
    # the texture cue is only for WHITE fabric: near-white, near-neutral pixels with weave texture.
    # (Applying it everywhere picks up the strong edges of coloured pieces and bridges the gaps.)
    near_white = (np.abs(L - paper_L) < 8.0) & (C < 6.0)
    woven = (tex > tex_thr) & near_white
    fg = (woven | darker | coloured).astype(np.uint8)
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (config.WHITE_BG_CLOSE_PX,) * 2))
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (config.WHITE_BG_OPEN_PX,) * 2))
    return fg.astype(bool)


def fabric_mask(lab: np.ndarray, poly: np.ndarray) -> np.ndarray:
    """Within the polygon, separate fabric from background that leaked inside it.

    The background colour is estimated from a ring just outside the polygon;
    pixels inside the polygon are fabric when their Lab distance from that
    background exceeds an Otsu threshold on the distance (never a lightness
    split, which would cut print motifs out of a printed specimen). Morphology
    open/close cleans the result. Falls back to the whole polygon when the
    background is indistinguishable from the fabric.
    """
    if poly.sum() < 50:
        return poly.copy()
    ring = cv2.dilate(poly.astype(np.uint8), np.ones((21, 21), np.uint8)).astype(bool) & ~poly
    if ring.sum() < 200:
        return poly.copy()  # polygon covers the whole frame: nothing to separate
    bg = np.median(lab[ring], axis=0)
    if bg[0] >= config.WHITE_BG_MIN_L and np.hypot(bg[1], bg[2]) < 6:
        # white paper around the piece: use texture / darkness cues (white fabric is close in colour)
        fab = poly & white_paper_foreground(lab, ring)
        return fab if fab.sum() >= 0.5 * poly.sum() else poly.copy()
    dist = np.sqrt(np.sum((lab - bg) ** 2, axis=-1))
    d_in = dist[poly]
    u8 = np.clip(d_in * 2.0, 0, 255).astype(np.uint8).reshape(-1, 1)
    thr, _ = cv2.threshold(u8, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    t = max(thr / 2.0, float(np.percentile(dist[ring], 90)) * 1.5, 6.0)
    fab = poly & (dist > t)
    if fab.sum() < 0.5 * poly.sum() or np.median(d_in) < config.FABRIC_BG_MIN_DL * 0.5:
        return poly.copy()
    k = np.ones((5, 5), np.uint8)
    fab = cv2.morphologyEx(fab.astype(np.uint8), cv2.MORPH_OPEN, k)
    fab = cv2.morphologyEx(fab, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8)).astype(bool)
    return fab & poly


def erode_edges(mask: np.ndarray, px: float) -> np.ndarray:
    r = int(round(px))
    if r < 1:
        return mask
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))
    return cv2.erode(mask.astype(np.uint8), k, borderType=cv2.BORDER_CONSTANT, borderValue=0).astype(bool)


def seam_mask(lab: np.ndarray, mask: np.ndarray, band_px: float) -> np.ndarray:
    """Detect long straight stitch lines (ridge filter + Hough) and mask a band."""
    out = np.zeros_like(mask)
    if mask.sum() < 500:
        return out
    L = lab[..., 0].astype(np.float32)
    ys, xs = np.nonzero(mask)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    sub = L[y0:y1, x0:x1]
    sub_m = mask[y0:y1, x0:x1]
    # ridge response: difference of Gaussians on lightness (both polarities)
    g1 = cv2.GaussianBlur(sub, (0, 0), 1.0)
    g2 = cv2.GaussianBlur(sub, (0, 0), 3.0)
    ridge = np.abs(g1 - g2)
    ridge[~sub_m] = 0
    vals = ridge[sub_m]
    if vals.size == 0:
        return out
    thr = max(np.percentile(vals, 99.0), 2.0)
    edges = ((ridge > thr) & sub_m).astype(np.uint8) * 255
    extent = max(sub.shape)
    min_len = int(config.SEAM_MIN_LENGTH_FRACTION * min(sub.shape) if min(sub.shape) > 0 else extent)
    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=max(30, min_len // 2), minLineLength=max(20, min_len), maxLineGap=6)
    if lines is None:
        return out
    band = np.zeros_like(sub_m, dtype=np.uint8)
    thick = max(1, int(round(band_px)))
    for x_a, y_a, x_b, y_b in lines[:, 0, :]:
        # only near-straight horizontal/vertical stitch lines
        ang = abs(math.degrees(math.atan2(y_b - y_a, x_b - x_a))) % 180
        if min(ang, abs(90 - ang), abs(180 - ang)) > 10:
            continue
        cv2.line(band, (int(x_a), int(y_a)), (int(x_b), int(y_b)), 1, thickness=thick)
    out[y0:y1, x0:x1] = band.astype(bool)
    return out & mask


def clean(
    lab: np.ndarray, poly: np.ndarray, ppmm: float, glare: np.ndarray | None = None, detect_seams: bool = True
) -> tuple[np.ndarray, dict]:
    """Fabric mask -> erode edges by EDGE_ERODE_MM -> mask seams -> mask glare."""
    fab = fabric_mask(lab, poly)
    eroded = erode_edges(fab, config.EDGE_ERODE_MM * ppmm)
    if eroded.sum() < 0.05 * max(1, fab.sum()):
        eroded = erode_edges(fab, 1)  # tiny region: minimal erosion
    seams = seam_mask(lab, eroded, config.SEAM_BAND_MM * ppmm) if detect_seams else np.zeros_like(eroded)
    valid = eroded & ~seams
    if glare is not None:
        valid &= ~glare
    info = {
        "poly_px": int(poly.sum()),
        "fabric_px": int(fab.sum()),
        "valid_px": int(valid.sum()),
        "seam_px": int(seams.sum()),
        "valid_share": round(float(valid.sum()) / max(1, int(poly.sum())), 4),
    }
    return valid, info


# ---------------------------------------------------------------------------
# Auto region detection
# ---------------------------------------------------------------------------


def background_mode(lab: np.ndarray, requested: str | None = None) -> str:
    """white | grey | black. 'auto' looks at the image border."""
    if requested and requested != "auto":
        return requested
    border = np.concatenate(
        [lab[:4].reshape(-1, 3), lab[-4:].reshape(-1, 3), lab[:, :4].reshape(-1, 3), lab[:, -4:].reshape(-1, 3)]
    )
    L = float(np.median(border[:, 0]))
    return "white" if L >= config.WHITE_BG_MIN_L else "black" if L < 20 else "grey"


def foreground_white_bg(lab: np.ndarray) -> np.ndarray:
    """Whole-image fabric map on white paper (paper measured on the image border)."""
    h, w = lab.shape[:2]
    border = np.zeros((h, w), bool)
    border[:6], border[-6:], border[:, :6], border[:, -6:] = True, True, True, True
    return white_paper_foreground(lab, border).astype(np.uint8)


def detect_regions(
    rgb: np.ndarray, lab: np.ndarray, expected_pieces: list[str], scale: float, background: str | None = None
) -> list[dict]:
    """Find fabric pieces against a neutral background.

    Returns ``[{piece_guess, polygon (original pixels), confidence}]``.
    Pieces: specimen = most chromatic / darkest, adjacents = whitest,
    ref card = highest internal colour variance.
    """
    h, w = lab.shape[:2]
    if background_mode(lab, background) == "white":
        fg = foreground_white_bg(lab)
    else:
        border = np.concatenate(
            [lab[:4].reshape(-1, 3), lab[-4:].reshape(-1, 3), lab[:, :4].reshape(-1, 3), lab[:, -4:].reshape(-1, 3)]
        )
        bg = np.median(border, axis=0)
        dist = np.sqrt(np.sum((lab - bg) ** 2, axis=-1))
        border_spread = float(np.percentile(np.sqrt(np.sum((border - bg) ** 2, axis=-1)), 95))
        thr = max(12.0, border_spread * 2.0)
        fg = (cv2.GaussianBlur(dist.astype(np.float32), (0, 0), 2.0) > thr).astype(np.uint8)
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
        fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, k)
        fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, k)

    contours, _ = cv2.findContours(fg, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    min_area = 0.01 * h * w
    contours = [c for c in contours if cv2.contourArea(c) >= min_area]
    contours.sort(key=cv2.contourArea, reverse=True)
    n_expected = max(1, len(expected_pieces))
    # stitched pieces (e.g. white satin sewn to a light-blue strip) form one blob: split blobs
    # into colour-coherent halves until the expected number of pieces is found
    i = 0
    while len(contours) < n_expected and i < len(contours):
        parts = split_stitched(lab, contours[i], (h, w))
        if parts:
            contours = contours[:i] + parts + contours[i + 1 :]
        i += 1 if not parts else 2
    contours.sort(key=cv2.contourArea, reverse=True)
    contours = contours[:n_expected]

    if not contours or (len(contours) == 1 and cv2.contourArea(contours[0]) > 0.97 * h * w):
        # fabric fills the frame: whole image with a small inset
        inset = 0.02
        poly = [
            [w * inset, h * inset],
            [w * (1 - inset), h * inset],
            [w * (1 - inset), h * (1 - inset)],
            [w * inset, h * (1 - inset)],
        ]
        piece = expected_pieces[0] if expected_pieces else "SPECIMEN"
        return [{"piece_guess": piece, "polygon": _to_original(poly, scale), "confidence": 0.5}]

    cands = []
    for c in contours:
        area = cv2.contourArea(c)
        rect = cv2.minAreaRect(c)
        rect_area = max(rect[1][0] * rect[1][1], 1.0)
        rectangularity = min(area / rect_area, 1.0)
        eps = 0.01 * cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, eps, True)[:, 0, :].astype(float)
        if len(approx) < 4 or len(approx) > 12:
            approx = cv2.boxPoints(rect)
        m = np.zeros((h, w), dtype=np.uint8)
        cv2.drawContours(m, [c], -1, 1, thickness=-1)
        mb = m.astype(bool)
        px = lab[mb]
        med = np.median(px, axis=0)
        cands.append(
            {
                "contour_area": area,
                "polygon": approx.tolist(),
                "L": float(med[0]),
                "C": float(np.hypot(med[1], med[2])),
                "spread": float(np.mean(np.std(px, axis=0))),
                "rectangularity": rectangularity,
                "cx": float(np.mean(np.nonzero(mb)[1])),
            }
        )

    assigned: list[dict] = []
    remaining = list(cands)
    pieces = list(expected_pieces) or ["SPECIMEN"]

    def take(key, reverse=True):
        remaining.sort(key=key, reverse=reverse)
        return remaining.pop(0)

    order = []
    if "REF_CARD" in pieces and remaining:
        c = take(lambda c: c["spread"])
        order.append(("REF_CARD", c))
    if "SPECIMEN" in pieces and remaining:
        c = take(lambda c: c["C"] + (100 - c["L"]) * 0.5)
        order.append(("SPECIMEN", c))
    adj = [p for p in pieces if p.startswith("ADJ")]
    adj_c = []
    for _ in adj:
        if not remaining:
            break
        adj_c.append(take(lambda c: c["L"] - c["C"]))
    adj_c.sort(key=lambda c: c["cx"])  # left-to-right: ADJ1, ADJ2
    for p, c in zip(adj, adj_c):
        order.append((p, c))
    for piece, c in order:
        conf = 0.4 + 0.5 * c["rectangularity"]
        assigned.append(
            {"piece_guess": piece, "polygon": _to_original(c["polygon"], scale), "confidence": round(min(conf, 0.95), 3)}
        )
    return assigned


def split_stitched(lab: np.ndarray, contour: np.ndarray, shape: tuple[int, int]) -> list | None:
    """Split one blob into two pieces of clearly different colour that each form one compact
    block (two fabrics stitched side by side). Returns two contours, or None if it is one piece."""
    from sklearn.cluster import KMeans

    m = np.zeros(shape, np.uint8)
    cv2.drawContours(m, [contour], -1, 1, thickness=-1)
    inner = cv2.erode(m, np.ones((5, 5), np.uint8)).astype(bool)
    px = lab[inner].astype(np.float64)
    if px.shape[0] < 400:
        return None
    rng = np.random.default_rng(0)
    sample = px[rng.choice(px.shape[0], min(5000, px.shape[0]), replace=False)]
    km = KMeans(n_clusters=2, n_init=3, random_state=0).fit(sample)
    if np.linalg.norm(km.cluster_centers_[0] - km.cluster_centers_[1]) < 8.0:
        return None
    lab_s = cv2.GaussianBlur(lab.astype(np.float32), (0, 0), 3.0)
    d = np.stack([np.sum((lab_s - c.astype(np.float32)) ** 2, axis=-1) for c in km.cluster_centers_], axis=-1)
    labels = np.argmin(d, axis=-1)
    out = []
    for k in (0, 1):
        part = ((labels == k) & m.astype(bool)).astype(np.uint8)
        part = cv2.morphologyEx(part, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))
        n, lbl, stats, _ = cv2.connectedComponentsWithStats(part, connectivity=8)
        if n < 2:
            return None
        big = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        area = stats[big, cv2.CC_STAT_AREA]
        if area < 0.2 * m.sum() or area < 0.8 * part.sum():
            return None  # print motif or scattered colour, not a second piece
        cs, _ = cv2.findContours((lbl == big).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        out.append(max(cs, key=cv2.contourArea))
    return out


def _to_original(poly, scale: float) -> list[list[float]]:
    return [[round(float(x) / scale, 1), round(float(y) / scale, 1)] for x, y in poly]


def mean_chroma(lab: np.ndarray, mask: np.ndarray) -> float:
    return float(np.median(chroma(lab[mask]))) if mask.any() else 0.0
