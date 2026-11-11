"""Image loading: EXIF orientation, 8/16-bit, HEIC, SHA-256."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps

try:  # optional HEIC support (pip install pillow-heif)
    import pillow_heif  # type: ignore

    pillow_heif.register_heif_opener()
    HEIC_SUPPORTED = True
except Exception:  # pragma: no cover - optional
    HEIC_SUPPORTED = False

SIXTEEN_BIT_SUFFIXES = {".png", ".tif", ".tiff"}


@dataclass
class LoadedImage:
    rgb: np.ndarray            # float32, HxWx3, sRGB-encoded 0..1, EXIF-oriented
    width: int
    height: int
    bit_depth: int
    sha256: str
    device: str | None = None
    exif: dict = field(default_factory=dict)


def sha256_file(path: str | Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _read_exif(pil: Image.Image) -> tuple[str | None, dict, int]:
    try:
        exif = pil.getexif()
    except Exception:
        return None, {}, 1
    make = str(exif.get(0x010F, "") or "").strip("\x00 ").strip()
    model = str(exif.get(0x0110, "") or "").strip("\x00 ").strip()
    orientation = int(exif.get(0x0112, 1) or 1)
    device = " ".join(p for p in (make, model) if p) or None
    return device, {"make": make or None, "model": model or None, "orientation": orientation}, orientation


def _apply_orientation(arr: np.ndarray, orientation: int) -> np.ndarray:
    if orientation == 2:
        return arr[:, ::-1]
    if orientation == 3:
        return arr[::-1, ::-1]
    if orientation == 4:
        return arr[::-1, :]
    if orientation == 5:
        return np.transpose(arr, (1, 0, 2))
    if orientation == 6:
        return np.rot90(arr, -1)
    if orientation == 7:
        return np.rot90(arr, 1)[::-1, :]
    if orientation == 8:
        return np.rot90(arr, 1)
    return arr


def load(path: str | Path) -> LoadedImage:
    """Load an image, apply EXIF orientation, keep 16-bit precision if present."""
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(str(path))
    digest = sha256_file(path)

    with Image.open(path) as pil:
        device, exif, orientation = _read_exif(pil)

    rgb: np.ndarray | None = None
    bit_depth = 8
    if path.suffix.lower() in SIXTEEN_BIT_SUFFIXES:
        arr = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
        if arr is not None and arr.dtype == np.uint16:
            if arr.ndim == 2:
                arr = np.stack([arr] * 3, axis=-1)
            arr = arr[:, :, :3][:, :, ::-1]  # BGR -> RGB
            bit_depth = 16
            rgb = _apply_orientation(arr.astype(np.float32) / 65535.0, orientation)

    if rgb is None:
        with Image.open(path) as pil:
            pil = ImageOps.exif_transpose(pil).convert("RGB")
            rgb = np.asarray(pil, dtype=np.float32) / 255.0

    rgb = np.ascontiguousarray(rgb, dtype=np.float32)
    h, w = rgb.shape[:2]
    return LoadedImage(rgb=rgb, width=w, height=h, bit_depth=bit_depth,
                       sha256=digest, device=device, exif=exif)


def downscale(rgb: np.ndarray, max_side: int) -> tuple[np.ndarray, float]:
    """Return (image, scale) where scale = new/original (<= 1)."""
    h, w = rgb.shape[:2]
    s = min(1.0, max_side / float(max(h, w)))
    if s >= 1.0:
        return rgb, 1.0
    out = cv2.resize(rgb, (max(1, round(w * s)), max(1, round(h * s))), interpolation=cv2.INTER_AREA)
    return out, s


def to_u8(rgb: np.ndarray) -> np.ndarray:
    return np.clip(rgb * 255.0 + 0.5, 0, 255).astype(np.uint8)


def save_rgb(rgb: np.ndarray, out_path: str | Path, quality: int = 90) -> str:
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    bgr = to_u8(rgb)[:, :, ::-1]
    if out_path.suffix.lower() in {".jpg", ".jpeg"}:
        cv2.imwrite(str(out_path), bgr, [cv2.IMWRITE_JPEG_QUALITY, quality])
    else:
        cv2.imwrite(str(out_path), bgr)
    return str(out_path)


def save_preview(rgb: np.ndarray, out_path: str | Path, max_side: int = 1600, quality: int = 90) -> str:
    """Write a browser-displayable 8-bit JPEG preview (originals stay untouched)."""
    small, _ = downscale(rgb, max_side)
    return save_rgb(small, out_path, quality)
