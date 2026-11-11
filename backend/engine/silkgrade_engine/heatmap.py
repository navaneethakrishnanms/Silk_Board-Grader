"""Per-pixel ΔE -> colour-map PNG overlaid on the after image."""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

from . import config
from .io import to_u8


def render(after_rgb: np.ndarray, emap: np.ndarray, max_de: float, out_path: str | Path,
           alpha: float = config.HEATMAP_ALPHA) -> str:
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    base = to_u8(after_rgb)
    grey = cv2.cvtColor(cv2.cvtColor(base, cv2.COLOR_RGB2GRAY), cv2.COLOR_GRAY2RGB)
    valid = ~np.isnan(emap)
    norm = np.zeros(emap.shape, dtype=np.uint8)
    norm[valid] = np.clip(emap[valid] / max_de * 255.0, 0, 255).astype(np.uint8)
    cmap = cv2.applyColorMap(norm, cv2.COLORMAP_TURBO)[:, :, ::-1]  # BGR -> RGB
    out = grey.copy()
    out[valid] = (alpha * cmap[valid] + (1 - alpha) * grey[valid]).astype(np.uint8)
    out = _legend(out, max_de)
    params = [cv2.IMWRITE_JPEG_QUALITY, 88] if out_path.suffix.lower() in {".jpg", ".jpeg"} else []
    cv2.imwrite(str(out_path), out[:, :, ::-1], params)
    return str(out_path)


def _legend(img: np.ndarray, max_de: float) -> np.ndarray:
    h, w = img.shape[:2]
    bar_h = max(14, h // 40)
    pad = 4
    canvas = np.full((h + bar_h + 2 * pad + 14, w, 3), 128, dtype=np.uint8)
    canvas[:h] = img
    ramp = np.tile(np.linspace(0, 255, w).astype(np.uint8), (bar_h, 1))
    canvas[h + pad:h + pad + bar_h] = cv2.applyColorMap(ramp, cv2.COLORMAP_TURBO)[:, :, ::-1]
    font = cv2.FONT_HERSHEY_SIMPLEX
    y = h + pad + bar_h + 12
    cv2.putText(canvas, "dE 0", (4, y), font, 0.4, (255, 255, 255), 1, cv2.LINE_AA)
    label = f"dE {max_de:g}+"
    cv2.putText(canvas, label, (w - 8 * len(label) - 4, y), font, 0.4, (255, 255, 255), 1, cv2.LINE_AA)
    return canvas
