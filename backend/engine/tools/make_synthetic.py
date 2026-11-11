"""Synthetic fabric pairs with known colour shifts (Section 11).

Usage:
    python tools/make_synthetic.py --out ../../storage/synthetic [--cases all|demo]

Writes PNG images plus ``manifest.json`` containing, per case, a ready-to-use
GradeRequest (paths relative to the output folder) and the expected result.
"""

from __future__ import annotations

import argparse
import json
import sys
import zlib
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from silkgrade_engine.colour import lab_to_srgb  # noqa: E402

DEFAULT_W, DEFAULT_H = 2400, 1700
BACKGROUND_LAB = (40.0, 0.0, 0.0)  # neutral grey / dark background (capture rule C6)


# ---------------------------------------------------------------------------
# texture + composition
# ---------------------------------------------------------------------------

def texture(h: int, w: int, seed: int, amp: float = 1.6) -> np.ndarray:
    """Multi-scale random texture in L* (non-periodic so registration works)."""
    rng = np.random.default_rng(seed)
    out = np.zeros((h, w), dtype=np.float32)
    for div, a in ((48, 1.0), (12, 0.8), (3, 0.6)):
        small = rng.normal(0, 1, (max(2, h // div), max(2, w // div))).astype(np.float32)
        out += a * cv2.resize(small, (w, h), interpolation=cv2.INTER_CUBIC)
    out = out / out.std() * amp
    out += rng.normal(0, 1.5, (h, w)).astype(np.float32)  # fine weave / sensor grain
    return out


def sensor_noise(h: int, w: int, seed: int, amp: float = 0.6) -> np.ndarray:
    return np.random.default_rng(seed).normal(0, amp, (h, w)).astype(np.float32)


def fabric_rect(h: int, w: int, inset: float = 0.04) -> tuple[int, int, int, int]:
    return int(h * inset), int(h * (1 - inset)), int(w * inset), int(w * (1 - inset))


def compose(lab_fabric: np.ndarray, rect, h, w, tex: np.ndarray, noise: np.ndarray) -> np.ndarray:
    lab = np.empty((h, w, 3), dtype=np.float32)
    lab[...] = BACKGROUND_LAB
    y0, y1, x0, x1 = rect
    lab[y0:y1, x0:x1] = lab_fabric[y0:y1, x0:x1]
    lab[y0:y1, x0:x1, 0] += tex[y0:y1, x0:x1]
    lab[..., 0] += noise
    return lab_to_srgb(lab).astype(np.float32)


def polygon_of(rect) -> list[list[float]]:
    y0, y1, x0, x1 = rect
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]


def plain(lab, h, w) -> np.ndarray:
    a = np.empty((h, w, 3), dtype=np.float32)
    a[...] = lab
    return a


def printed_layout(h, w, seed=7):
    """Ground + two motif colours (circles and bars). Returns label image 0/1/2."""
    rng = np.random.default_rng(seed)
    labels = np.zeros((h, w), dtype=np.uint8)
    for _ in range(14):
        cy, cx = int(rng.uniform(0.15, 0.85) * h), int(rng.uniform(0.1, 0.9) * w)
        r = int(rng.uniform(0.04, 0.08) * h)
        cv2.circle(labels, (cx, cy), r, 1, -1)
    for _ in range(5):
        cy, cx = int(rng.uniform(0.15, 0.85) * h), int(rng.uniform(0.1, 0.9) * w)
        cv2.rectangle(labels, (cx - int(0.06 * w), cy - int(0.02 * h)), (cx + int(0.06 * w), cy + int(0.02 * h)), 2, -1)
    return labels


def printed(colours, labels) -> np.ndarray:
    h, w = labels.shape
    a = np.empty((h, w, 3), dtype=np.float32)
    for i, c in enumerate(colours):
        a[labels == i] = c
    return a


def transform(img: np.ndarray, poly, angle_deg: float, tx: float, ty: float):
    h, w = img.shape[:2]
    M = cv2.getRotationMatrix2D((w / 2, h / 2), angle_deg, 1.0)
    M[:, 2] += (tx, ty)
    bg = lab_to_srgb(np.array(BACKGROUND_LAB))
    out = cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT,
                         borderValue=tuple(float(v) for v in bg))
    pts = np.hstack([np.asarray(poly, dtype=np.float64), np.ones((len(poly), 1))]) @ M.T
    return out, pts.tolist()


def save(path: Path, rgb: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    u8 = np.clip(rgb * 255.0 + 0.5, 0, 255).astype(np.uint8)
    cv2.imwrite(str(path), u8[:, :, ::-1], [cv2.IMWRITE_PNG_COMPRESSION, 1])


# ---------------------------------------------------------------------------
# cases
# ---------------------------------------------------------------------------

WHITE_SILK = (93.0, -0.3, 2.0)
WHITE_COTTON = (94.0, 0.0, 1.0)
SPEC_PLAIN = (50.0, 35.0, 15.0)  # L*=50: ΔE00 of a lightness shift ≈ ΔL*


def case_files(out: Path, name: str, h: int, w: int, spec_before, spec_after, adj_before, adj_after,
               after_transform=None, n_adj: int = 2):
    """Writes the images of one composite test. ``spec_*`` / ``adj_*`` are Lab
    fabric images (HxWx3) already including any print pattern / stain."""
    rect = fabric_rect(h, w)
    poly = polygon_of(rect)
    d = out / name
    seed = zlib.crc32(name.encode()) % 10_000
    tex_spec = texture(h, w, seed + 1)
    sb = compose(spec_before, rect, h, w, tex_spec, sensor_noise(h, w, seed + 2))
    sa = compose(spec_after, rect, h, w, tex_spec, sensor_noise(h, w, seed + 3))
    poly_after = poly
    if after_transform:
        sa, poly_after = transform(sa, poly, *after_transform)
        # bilinear warping softens the grain; re-add camera grain after the move
        grain = np.random.default_rng(seed + 4).normal(0, 0.012, sa.shape).astype(np.float32)
        sa = np.clip(sa + grain, 0.0, 1.0)
    save(d / "specimen_before.png", sb)
    save(d / "specimen_after.png", sa)
    pairs = {"specimen": {"before": {"path": f"{name}/specimen_before.png", "polygon": poly},
                          "after": {"path": f"{name}/specimen_after.png", "polygon": poly_after}}}
    for i in range(n_adj):
        k = f"adj{i + 1}"
        tex = texture(h, w, seed + 10 + i, amp=1.0)
        ab = compose(adj_before[i], rect, h, w, tex, sensor_noise(h, w, seed + 20 + i))
        aa = compose(adj_after[i], rect, h, w, texture(h, w, seed + 30 + i, amp=1.0), sensor_noise(h, w, seed + 40 + i))
        save(d / f"{k}_before.png", ab)
        save(d / f"{k}_after.png", aa)
        pairs[k] = {"before": {"path": f"{name}/{k}_before.png", "polygon": poly},
                    "after": {"path": f"{name}/{k}_after.png", "polygon": poly}}
    return pairs


def build_cases(out: Path, which: str = "all", w: int = DEFAULT_W, h: int = DEFAULT_H) -> list[dict]:
    out.mkdir(parents=True, exist_ok=True)
    cases = []
    white2 = [plain(WHITE_SILK, h, w), plain(WHITE_COTTON, h, w)]

    def add(name, fabric_type, pairs, expected, description, demo=False, adj_count=2):
        if which == "demo" and not demo:
            return
        cases.append({
            "name": name, "description": description, "demo": demo,
            "request": {"test_id": name, "fabric_type": fabric_type, "adj_count": adj_count,
                        "adj_fibres": ["silk", "cotton"][:adj_count],
                        "required": {"change": 4.0, "stain": 3.5},
                        "pairs": pairs, "ref_card": {"before": None, "after": None},
                        "options": {"stain_statistic": "p90", "change_rule": "area_weighted"}},
            "expected": expected,
        })

    def want(name):
        return which == "all" or name in DEMO_CASES

    # 1. identical before / after
    if want("identical_plain"):
        sp = plain(SPEC_PLAIN, h, w)
        add("identical_plain", "PLAIN",
            case_files(out, "identical_plain", h, w, sp, sp, white2, white2),
            {"CHANGE_OVERALL": 5.0, "STAIN_ADJ1": 5.0, "STAIN_ADJ2": 5.0},
            "Identical before/after images: every grade 5")

    # 2. plain, lightness shift ΔE 3.4
    if want("plain_shift_3_4"):
        sb = plain(SPEC_PLAIN, h, w)
        sa = plain((SPEC_PLAIN[0] + 3.4, SPEC_PLAIN[1], SPEC_PLAIN[2]), h, w)
        add("plain_shift_3_4", "PLAIN",
            case_files(out, "plain_shift_3_4", h, w, sb, sa, white2, white2),
            {"CHANGE_OVERALL": 3.0, "STAIN_ADJ1": 5.0},
            "Plain specimen, lightness shift ΔL* = +3.4 -> change grade 3", demo=True)

    # 3. white adjacent stained to ΔE 8.5 (mostly greyish)
    if want("stained_white_8_5"):
        sp = plain(SPEC_PLAIN, h, w)
        st = (WHITE_SILK[0] - 8.0, WHITE_SILK[1] + 1.0, WHITE_SILK[2] + 2.7)
        stained = [plain(st, h, w), plain((WHITE_COTTON[0] - 2.0, 0.3, 1.8), h, w)]
        add("stained_white_8_5", "PLAIN",
            case_files(out, "stained_white_8_5", h, w, sp, sp, white2, stained),
            {"STAIN_ADJ1": 3.0, "CHANGE_OVERALL": 5.0},
            "Silk adjacent stained to ΔE*ab ≈ 8.5 -> staining grade 3", demo=True)

    # 4. printed: only one motif colour fades
    if want("printed_motif_fade"):
        labels = printed_layout(h, w)
        ground, teal, yellow = (45.0, 40.0, 20.0), (55.0, -30.0, -10.0), (80.0, 5.0, 70.0)
        before = printed([ground, teal, yellow], labels)
        after = printed([ground, (60.0, -22.0, -6.0), yellow], labels)  # teal fades
        add("printed_motif_fade", "PRINTED",
            case_files(out, "printed_motif_fade", h, w, before, after, white2, white2),
            {"CHANGE_GROUND": 5.0, "motif_below": 5.0, "worst_is_motif": True},
            "Printed specimen where only the teal motif fades", demo=True)

    # 5. shifted / rotated after image, same colour change as case 2
    if want("shifted_rotated"):
        sb = plain(SPEC_PLAIN, h, w)
        sa = plain((SPEC_PLAIN[0] + 3.4, SPEC_PLAIN[1], SPEC_PLAIN[2]), h, w)
        add("shifted_rotated", "PLAIN",
            case_files(out, "shifted_rotated", h, w, sb, sa, white2, white2, after_transform=(2.5, 45.0, -30.0)),
            {"registration_ok": True, "same_as": "plain_shift_3_4"},
            "After image rotated 2.5° and shifted (45, -30) px")

    # 6. clipped whites on the adjacent fabric
    if want("clipped_whites"):
        sp = plain(SPEC_PLAIN, h, w)
        hot = [plain((99.6, 0.0, 0.0), h, w), plain(WHITE_COTTON, h, w)]
        add("clipped_whites", "PLAIN",
            case_files(out, "clipped_whites", h, w, sp, sp, hot, hot),
            {"warning": "clipping", "decision": "REVIEW"},
            "Over-exposed white adjacent fabric -> clipping warning, REVIEW")

    # 7. glare on the specimen
    if want("glare"):
        sp = plain(SPEC_PLAIN, h, w)
        g = sp.copy()
        rng = np.random.default_rng(3)
        for _ in range(6):
            cy, cx = int(rng.uniform(0.2, 0.8) * h), int(rng.uniform(0.2, 0.8) * w)
            m = np.zeros((h, w), np.uint8)
            cv2.circle(m, (cx, cy), int(0.03 * h), 1, -1)
            g[m.astype(bool)] = (99.0, 0.0, 0.0)
        add("glare", "PLAIN",
            case_files(out, "glare", h, w, g, g, white2, white2),
            {"warning": "glare", "decision": "REVIEW"},
            "Specular highlights on the specimen -> glare warning, REVIEW")

    (out / "manifest.json").write_text(json.dumps({"cases": cases}, indent=2), encoding="utf-8")
    return cases


DEMO_CASES = {"plain_shift_3_4", "stained_white_8_5", "printed_motif_fade"}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", required=True)
    ap.add_argument("--cases", default="all", choices=["all", "demo"])
    ap.add_argument("--width", type=int, default=DEFAULT_W)
    ap.add_argument("--height", type=int, default=DEFAULT_H)
    a = ap.parse_args()
    cases = build_cases(Path(a.out), a.cases, a.width, a.height)
    print(f"wrote {len(cases)} cases to {Path(a.out).resolve()}")


if __name__ == "__main__":
    main()
