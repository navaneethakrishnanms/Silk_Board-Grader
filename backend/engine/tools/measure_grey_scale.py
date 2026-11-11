"""Dev tool (WP4.6): measure a grey-scale card scan as a CHECK of card wear + scanner — never used for grading.

    python tools/measure_grey_scale.py --kind change   --images p1.png p2.png --out ../../docs/tuning/grey_scale_check.md
    python tools/measure_grey_scale.py --kind staining --images p1.png p2.png --out ../../docs/tuning/grey_scale_check.md --append

Each pair = reference patch + step patch (one above the other). Patches are found automatically
(uniform rectangles not touching the border) or given with --pairs pairs.json
([[[x,y,w,h],[x,y,w,h]], ...] per image). For every pair: median CIELAB, ΔE*ab, ΔL*, ΔE00, and the
grade the engine formula gives (ISO 105-A05 change / A04 staining), against the nominal step table.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from silkgrade_engine.colour import delta_e_2000, delta_e_ab, delta_e_f, to_lab  # noqa: E402
from silkgrade_engine.config import CHANGE_SCALE_DE, GRADE_LABEL, STAIN_SCALE_DE  # noqa: E402
from silkgrade_engine.io import load  # noqa: E402
from silkgrade_engine.iso_grading import change_rating, stain_rating  # noqa: E402


def find_patches(lab: np.ndarray) -> list[tuple[int, int, int, int]]:
    L = lab[..., 0].astype(np.float32)
    mean = cv2.GaussianBlur(L, (0, 0), 3)
    sq = cv2.GaussianBlur(L * L, (0, 0), 3)
    std = np.sqrt(np.maximum(sq - mean * mean, 0))
    uniform = (std < 1.0).astype(np.uint8)
    uniform = cv2.morphologyEx(uniform, cv2.MORPH_OPEN, np.ones((7, 7), np.uint8))
    n, lbl, stats, _ = cv2.connectedComponentsWithStats(uniform, connectivity=4)
    h, w = L.shape
    rects = []
    for i in range(1, n):
        x, y, ww, hh, area = stats[i]
        if x <= 2 or y <= 2 or x + ww >= w - 2 or y + hh >= h - 2:
            continue  # the card mount / page touches the border
        if area < 0.002 * h * w or area / float(ww * hh) < 0.85:
            continue
        rects.append((int(x), int(y), int(ww), int(hh)))
    if not rects:
        return rects
    # two identical patches stacked (e.g. the grade-5 pair) merge into one tall block: split it
    typical = float(np.median([r[3] for r in rects if r[3] <= 1.3 * min(rr[3] for rr in rects)] or [rects[0][3]]))
    out = []
    for x, y, ww, hh in rects:
        k = int(round(hh / typical)) if hh > 1.5 * typical else 1
        for i in range(k):
            out.append((x, int(y + i * hh / k), ww, int(hh / k)))
    return out


def pair_patches(rects: list[tuple[int, int, int, int]]) -> list[tuple[tuple, tuple]]:
    rects = sorted(rects, key=lambda r: r[0] + r[2] / 2)
    pairs, used = [], set()
    for i, a in enumerate(rects):
        if i in used:
            continue
        ca = a[0] + a[2] / 2
        for j in range(i + 1, len(rects)):
            b = rects[j]
            if j not in used and abs((b[0] + b[2] / 2) - ca) < a[2] / 2:
                top, bot = sorted((a, b), key=lambda r: r[1])
                pairs.append((top, bot))
                used |= {i, j}
                break
    # a step patch the same grey as the card mount merges into it: take the same-size
    # rectangle directly below the unpaired reference patch (cards stack ref over step)
    if pairs:
        top_row = np.median([p[0][1] for p in pairs])
        for i, a in enumerate(rects):
            if i not in used and abs(a[1] - top_row) < a[3] / 2:
                pairs.append((a, (a[0], a[1] + a[3], a[2], a[3])))
                used.add(i)
    return sorted(pairs, key=lambda p: p[0][0])


def median_lab(lab, r, inset=0.2) -> np.ndarray:
    x, y, w, h = r
    dx, dy = int(w * inset), int(h * inset)
    return np.median(lab[y + dy : y + h - dy, x + dx : x + w - dx].reshape(-1, 3), axis=0)


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # Windows consoles default to cp1252
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--kind", required=True, choices=["change", "staining"])
    ap.add_argument("--images", nargs="+", required=True)
    ap.add_argument("--pairs", default=None, help="JSON file with manual pair rectangles per image")
    ap.add_argument("--out", default=None)
    ap.add_argument("--append", action="store_true")
    a = ap.parse_args()
    manual = json.loads(Path(a.pairs).read_text()) if a.pairs else None
    rows = []
    for k, path in enumerate(a.images):
        lab = to_lab(load(path).rgb)
        pairs = [tuple(map(tuple, p)) for p in manual[k]] if manual else pair_patches(find_patches(lab))
        for top, bot in pairs:
            ref, step = median_lab(lab, top), median_lab(lab, bot)
            if a.kind == "staining" and step[0] > ref[0]:  # reference is the lighter (white) patch
                ref, step = step, ref
            dE = float(delta_e_ab(ref, step))
            dL = float(step[0] - ref[0])
            de00 = float(delta_e_2000(ref, step))
            if a.kind == "change":
                dEF, _ = delta_e_f(ref, step)
                g = change_rating(float(dEF))
            else:
                g = stain_rating(dE, dL)
            rows.append(
                {
                    "image": Path(path).name,
                    "ref_L": round(float(ref[0]), 2),
                    "step_L": round(float(step[0]), 2),
                    "dE_ab": round(dE, 2),
                    "dL": round(dL, 2),
                    "dE00": round(de00, 2),
                    "formula_grade": round(g, 2),
                }
            )
    scale = CHANGE_SCALE_DE if a.kind == "change" else STAIN_SCALE_DE
    steps = sorted(scale.items(), reverse=True)  # (5, 0.0) ... (1, max)
    if len(rows) == 5:
        steps = [s for s in steps if s[0] in (5.0, 4.0, 3.0, 2.0, 1.0)]
    rows.sort(key=lambda r: r["dE_ab"])
    title = "Colour-change" if a.kind == "change" else "Staining"
    files = ", ".join(Path(p).name for p in a.images)
    lines = [
        f"## {title} grey scale — {len(rows)} pairs ({files})",
        "",
        "| step | nominal ΔE | measured ΔE*ab | ΔL* | ΔE00 | formula grade | grade error |",
        "|---|---|---|---|---|---|---|",
    ]
    for r, (grade, nom) in zip(rows, steps):
        r["nominal_grade"], r["nominal_dE"] = grade, nom
        lines.append(
            f"| {GRADE_LABEL[grade]} | {nom:.1f} | {r['dE_ab']:.2f} | {r['dL']:+.2f} | {r['dE00']:.2f} "
            f"| {r['formula_grade']:.2f} | {r['formula_grade'] - grade:+.2f} |"
        )
    if len(rows) not in (5, 9):
        lines += ["", f"⚠ found {len(rows)} pairs (expected 5 or 9) — check the detection or pass --pairs."]
    errs = [abs(r["formula_grade"] - r["nominal_grade"]) for r in rows if "nominal_grade" in r]
    if errs:
        lines += [
            "",
            f"Max |grade error| {max(errs):.2f}, mean {np.mean(errs):.2f}. "
            "This measures card wear + scanner + formula together. **Not used for grading.**",
            "",
        ]
    text = "\n".join(lines)
    print(text)
    if a.out:
        out = Path(a.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        if a.append and out.exists():
            text = out.read_text(encoding="utf-8").rstrip() + "\n\n" + text
        out.write_text(text + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
