"""SYNTHETIC stand-ins for the client's scans (WP4), used until the real scans are in docs/client_samples/.

    python tools/make_client_standins.py --out ../../docs/client_samples_synthetic

* fabric_sheet.png      — WHITE paper; printed floral specimen (light-cyan ground, dark-teal motif,
                          green stems); white lustrous satin strip (sheen highlights) stitched to a
                          light-blue strip; large original fabric; frayed thread edges; whites near 255.
* grey_scale_change_p1/p2.png   — colour-change grey scale, pairs at the nominal ISO 105-A02 steps
* grey_scale_staining_p1/p2.png — staining grey scale, pairs at the nominal ISO 105-A03 steps
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from silkgrade_engine.colour import lab_to_srgb  # noqa: E402
from silkgrade_engine.config import CHANGE_SCALE_DE, STAIN_SCALE_DE  # noqa: E402

PAPER = (96.5, 0.0, 1.0)
GROUND, MOTIF, STEMS = (82.0, -14.0, -9.0), (38.0, -24.0, -12.0), (55.0, -32.0, 28.0)
SATIN, BLUE = (94.0, -0.4, 1.8), (80.0, -6.0, -16.0)


def _rgb(lab: np.ndarray) -> np.ndarray:
    return lab_to_srgb(lab).astype(np.float32)


def _save(path: Path, rgb: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    u8 = np.clip(rgb * 255 + 0.5, 0, 255).astype(np.uint8)
    cv2.imwrite(str(path), u8[:, :, ::-1])


def _weave(h, w, rng, amp=1.4):
    t = rng.normal(0, 1, (h, w)).astype(np.float32)
    t = cv2.GaussianBlur(t, (0, 0), 0.8) * amp * 2.0
    yy, xx = np.mgrid[0:h, 0:w]
    t += 0.6 * amp * np.sin(xx * 1.9) * np.sin(yy * 1.7)  # fine weave pattern
    return t


def fabric_sheet(h=1700, w=2400, seed=5) -> tuple[np.ndarray, dict]:
    rng = np.random.default_rng(seed)
    lab = np.empty((h, w, 3), np.float32)
    lab[...] = PAPER
    lab[..., 0] += rng.normal(0, 0.25, (h, w))  # smooth paper
    truth = {}

    def piece(name, y0, y1, x0, x1, base, fray=True):
        lab[y0:y1, x0:x1] = base
        lab[y0:y1, x0:x1, 0] += _weave(y1 - y0, x1 - x0, rng)
        if fray:  # loose threads leaving the edges
            for _ in range(25):
                side = rng.integers(0, 4)
                L = int(rng.integers(15, 45))
                if side == 0:
                    x = int(rng.integers(x0, x1))
                    cv2.line(lab, (x, y0), (x + int(rng.integers(-8, 8)), y0 - L), base, 1)  # noqa: E702
                elif side == 1:
                    x = int(rng.integers(x0, x1))
                    cv2.line(lab, (x, y1), (x + int(rng.integers(-8, 8)), y1 + L), base, 1)  # noqa: E702
                elif side == 2:
                    y = int(rng.integers(y0, y1))
                    cv2.line(lab, (x0, y), (x0 - L, y + int(rng.integers(-8, 8))), base, 1)  # noqa: E702
                else:
                    y = int(rng.integers(y0, y1))
                    cv2.line(lab, (x1, y), (x1 + L, y + int(rng.integers(-8, 8))), base, 1)  # noqa: E702
        truth[name] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]

    # 1. printed floral specimen
    y0, y1, x0, x1 = 120, 760, 120, 1100
    piece("specimen_printed", y0, y1, x0, x1, GROUND)
    for _ in range(18):
        cy, cx = int(rng.uniform(y0 + 40, y1 - 40)), int(rng.uniform(x0 + 40, x1 - 40))
        for k in range(5):  # petals
            ang = k * 2 * np.pi / 5
            cv2.ellipse(
                lab, (int(cx + 22 * np.cos(ang)), int(cy + 22 * np.sin(ang))), (20, 11), np.degrees(ang), 0, 360, MOTIF, -1
            )
        cv2.line(lab, (cx, cy), (cx + int(rng.integers(-60, 60)), cy + 70), STEMS, 6)
        cv2.ellipse(lab, (cx + 18, cy + 45), (16, 7), 30, 0, 360, STEMS, -1)
    lab[y0:y1, x0:x1, 0] += _weave(y1 - y0, x1 - x0, rng, 0.8)

    # 2. white satin strip stitched to light-blue strip (one composite)
    y0, y1, xs0, xm, xs1 = 120, 760, 1250, 1650, 2050
    piece("adj_white_satin", y0, y1, xs0, xm, SATIN)
    piece("adj_light_blue", y0, y1, xm, xs1, BLUE)
    for yy in range(y0, y1, 9):  # stitch line along the seam
        cv2.line(lab, (xm - 2, yy), (xm + 2, yy + 5), (60.0, 0.0, 0.0), 2)
    for _ in range(5):  # satin sheen highlights (specular, near 255)
        cy, cx = int(rng.uniform(y0 + 60, y1 - 60)), int(rng.uniform(xs0 + 40, xm - 40))
        m = np.zeros((h, w), np.uint8)
        cv2.ellipse(m, (cx, cy), (70, 14), float(rng.uniform(-30, 30)), 0, 360, 1, -1)
        lab[m.astype(bool)] = (100.0, 0.0, 0.0)  # scanner whites at 255 (clipped)

    # 3. large original fabric
    piece("original_fabric", 900, 1580, 120, 2050, GROUND, fray=False)
    lab[900:1580, 120:2050, 0] += _weave(680, 1930, rng, 0.6)
    return _rgb(lab), truth


def grey_card(kind: str, page: int, h=900, w=1500) -> tuple[np.ndarray, list]:
    """Pairs of patches side by side; pair i = reference (top) + step (bottom) at the nominal ΔE."""
    scale = CHANGE_SCALE_DE if kind == "change" else STAIN_SCALE_DE
    steps = sorted(scale.items(), reverse=True)  # 5.0 ... 1.0
    steps = steps[:5] if page == 1 else steps[5:]
    ref = (50.0, 0.0, 0.0) if kind == "change" else (95.0, 0.0, 0.0)
    lab = np.empty((h, w, 3), np.float32)
    lab[...] = (35.0, 0.0, 0.0) if kind == "change" else (70.0, 0.0, 0.0)  # card mount
    truth = []
    pw, ph, gap = 200, 260, 70
    x = 80
    for grade, de in steps:
        top = (ref[0], 0.0, 0.0)
        bot = (ref[0] - de, 0.0, 0.0)  # neutral lightness step: ΔE*ab = ΔL = nominal
        lab[180 : 180 + ph, x : x + pw] = top
        lab[180 + ph : 180 + 2 * ph, x : x + pw] = bot
        truth.append({"grade": grade, "nominal_dE": de, "top": [x, 180, pw, ph], "bottom": [x, 180 + ph, pw, ph]})
        x += pw + gap
    lab[..., 0] += np.random.default_rng(page).normal(0, 0.3, (h, w))
    return _rgb(lab), truth


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    out = Path(a.out)
    rgb, truth = fabric_sheet()
    _save(out / "fabric_sheet.png", rgb)
    meta = {"SYNTHETIC": "stand-ins for the client scans — not real data", "fabric_sheet": truth}
    for kind in ("change", "staining"):
        for page in (1, 2):
            rgb, t = grey_card(kind, page)
            _save(out / f"grey_scale_{kind}_p{page}.png", rgb)
            meta[f"grey_scale_{kind}_p{page}"] = t
    (out / "truth.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    (out / "README.md").write_text(
        "# SYNTHETIC stand-ins — not client data\n\nGenerated by `backend/engine/tools/make_client_standins.py` "
        "to exercise the WP4 tuning tools until the real client scans are placed in `docs/client_samples/`.\n",
        encoding="utf-8",
    )
    print(f"wrote stand-ins to {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
