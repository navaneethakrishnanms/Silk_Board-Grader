"""WP4 tuning tool: run segmentation, masking and clustering on a scan and save the evidence.

    python tools/tune_client_scans.py --image ../../docs/client_samples/fabric_sheet.jpg \
        --pieces 4 --background white --out ../../docs/tuning --time-grading

Saves to --out:
    <stem>_regions.png   detected pieces (polygons, labels, colour)
    <stem>_masks.png     per piece: valid measuring area (green), removed edge band incl. frayed
                         threads (blue), seam band (red), glare (yellow)
    <stem>_clusters.png  print-colour clusters of the most multi-coloured piece
    <stem>_report.json   numbers for docs/tuning/CHANGELOG.md
If a truth.json from tools/make_client_standins.py sits next to the image, the report also checks
the result against the known geometry (frayed threads outside the true piece, seam leakage).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from silkgrade_engine import cluster, config, quality, segment  # noqa: E402
from silkgrade_engine.colour import to_lab  # noqa: E402
from silkgrade_engine.io import downscale, load, to_u8  # noqa: E402
from silkgrade_engine.pipeline import hue_name  # noqa: E402

COLOURS = [(37, 99, 235), (22, 163, 74), (217, 119, 6), (192, 38, 211), (220, 38, 38), (13, 148, 136)]


def find_pieces(rgb, lab, n, background):
    names = ["SPECIMEN", "ADJ1", "ADJ2", "REF_CARD", "SPECIMEN", "ADJ1"][:n]
    regs = segment.detect_regions(rgb, lab, names, 1.0, background)
    out = []
    for r in regs:
        poly = segment.polygon_mask(lab.shape[:2], r["polygon"], 1.0)
        med = np.median(lab[poly], axis=0)
        out.append(
            {
                "polygon": r["polygon"],
                "mask": poly,
                "median_lab": [round(float(v), 2) for v in med],
                "chroma": round(float(np.hypot(med[1], med[2])), 2),
                "hue": hue_name(med),
                "colour_spread": round(float(np.mean(np.std(lab[poly], axis=0))), 2),
                "area_px": int(poly.sum()),
            }
        )
    return out


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # Windows consoles default to cp1252
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--image", required=True)
    ap.add_argument("--pieces", type=int, default=4)
    ap.add_argument("--background", default="auto", choices=["auto", "white", "grey", "black"])
    ap.add_argument("--out", required=True)
    ap.add_argument("--time-grading", action="store_true")
    a = ap.parse_args()
    img_path, out = Path(a.image), Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    stem = ("synthetic_" if "synthetic" in str(img_path.parent).lower() else "") + img_path.stem

    t0 = time.perf_counter()
    img = load(img_path)
    small, s = downscale(img.rgb, config.ANALYSIS_MAX_SIDE)
    lab = to_lab(small)
    mode = segment.background_mode(lab, a.background)
    pieces = find_pieces(small, lab, a.pieces, mode)
    t_detect = time.perf_counter() - t0

    reg_img = to_u8(small).copy()
    mask_img = cv2.cvtColor(cv2.cvtColor(to_u8(small), cv2.COLOR_RGB2GRAY), cv2.COLOR_GRAY2RGB) // 2 + 64
    report = {
        "image": str(img_path),
        "size": [img.width, img.height],
        "analysis_scale": round(s, 4),
        "background": mode,
        "detect_seconds": round(t_detect, 2),
        "pieces": [],
    }
    for i, p in enumerate(pieces):
        col = COLOURS[i % len(COLOURS)]
        pts = np.round(np.array(p["polygon"])).astype(np.int32)
        cv2.polylines(reg_img, [pts], True, col, 3)
        cv2.putText(
            reg_img,
            f"{i + 1}: {p['hue']} C*{p['chroma']:.0f}",
            tuple(int(v) for v in pts.min(axis=0) + [6, 24]),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            col,
            2,
            cv2.LINE_AA,
        )
        poly = p.pop("mask")
        white = p["median_lab"][0] > 80 and p["chroma"] < 12
        ppmm = segment.px_per_mm(poly)
        fab = segment.fabric_mask(lab, poly)
        eroded = segment.erode_edges(fab, config.EDGE_ERODE_MM * ppmm)
        q = quality.check(small, lab, eroded, full_res_area_px=fab.sum() / (s * s), expect_white=white)
        seams = segment.seam_mask(lab, eroded, config.SEAM_BAND_MM * ppmm)
        valid = eroded & ~seams & ~q["glare_mask"]
        mask_img[poly & ~eroded] = (59, 130, 246)
        mask_img[valid] = (34, 197, 94)
        mask_img[seams] = (239, 68, 68)
        mask_img[q["glare_mask"] & poly] = (250, 204, 21)
        p.update(
            {
                "white_fabric": white,
                "px_per_mm_est": round(ppmm / s, 2),
                "warnings": q["warnings"],
                "metrics": q["metrics"],
                "valid_share": round(float(valid.sum()) / max(1, poly.sum()), 3),
                "seam_px": int(seams.sum()),
                "glare_share": round(float(q["glare_mask"].sum()) / max(1, poly.sum()), 4),
            }
        )
        p["_valid"] = valid
        report["pieces"].append(p)

    cv2.imwrite(str(out / f"{stem}_regions.png"), reg_img[:, :, ::-1])
    cv2.imwrite(str(out / f"{stem}_masks.png"), mask_img[:, :, ::-1])

    # clusters of the most multi-coloured piece (the printed specimen)
    printed = max(report["pieces"], key=lambda p: p["colour_spread"]) if report["pieces"] else None
    if printed is not None:
        cl = cluster.print_colours(lab, printed["_valid"])
        cmap = np.full(small.shape, 128, np.uint8)
        legend = []
        for k, (m, c) in enumerate(zip(cl.masks, cl.centers)):
            from silkgrade_engine.colour import lab_to_srgb

            sw = (np.clip(lab_to_srgb(np.array(c)), 0, 1) * 255).astype(np.uint8)
            cmap[m] = sw
            legend.append(
                {
                    "cluster": k,
                    "role": "ground" if k == 0 else f"motif {k}",
                    "lab": [round(float(v), 1) for v in c],
                    "hue": hue_name(c),
                    "share": round(cl.shares[k], 3),
                }
            )
        cv2.imwrite(str(out / f"{stem}_clusters.png"), cmap[:, :, ::-1])
        report["clusters"] = {
            "piece": report["pieces"].index(printed) + 1,
            "k": cl.k,
            "silhouette": round(cl.silhouette, 3),
            "colours": legend,
        }

    truth_path = img_path.parent / "truth.json"
    if truth_path.exists():
        truth = json.loads(truth_path.read_text(encoding="utf-8")).get(img_path.stem, {})
        checks = {}
        for name, rect in truth.items():
            x0, y0 = (np.array(rect[0]) * s).astype(int)
            x1, y1 = (np.array(rect[2]) * s).astype(int)
            inside = np.zeros(small.shape[:2], bool)
            inside[y0:y1, x0:x1] = True
            best = max(report["pieces"], key=lambda p: (p["_valid"] & inside).sum())
            v = best["_valid"]
            checks[name] = {
                "matched_piece": report["pieces"].index(best) + 1,
                "valid_px_outside_true_piece (frayed threads/background)": int((v & ~inside).sum()),
                "covers_share_of_true_piece": round(float((v & inside).sum()) / max(1, inside.sum()), 3),
            }
        report["truth_checks"] = checks

    for p in report["pieces"]:
        p.pop("_valid", None)
    if a.time_grading and len(report["pieces"]) >= 2:
        from silkgrade_engine import grade_test

        # same scan as before AND after: times a full-resolution grading of these regions
        pcs = [p["polygon"] for p in report["pieces"]]
        orig = [[[x / s, y / s] for x, y in poly] for poly in pcs]
        req = {
            "test_id": "tuning",
            "fabric_type": "PRINTED",
            "adj_count": min(2, len(orig) - 1),
            "adj_fibres": ["silk", "silk"],
            "required": {},
            "ref_card": None,
            "options": {},
            "pairs": {
                k: {"before": {"path": str(img_path), "polygon": orig[i]}, "after": {"path": str(img_path), "polygon": orig[i]}}
                for i, k in enumerate(["specimen", "adj1", "adj2"][: min(3, len(orig))])
            },
        }
        t1 = time.perf_counter()
        import tempfile

        res = grade_test(req, Path(tempfile.mkdtemp(prefix="sg_tune_")))
        report["grading_seconds_full_res"] = round(time.perf_counter() - t1, 2)
        report["grading_timings_ms"] = res["timings_ms"]
        report["grading_warnings"] = res["warnings"]
        report["grading_decisions"] = {
            g["kind"]: {"decision": g["decision"], "reasons": g["features"]["review_reasons"]} for g in res["grades"]
        }
    (out / f"{stem}_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "pieces"}, indent=2))
    for i, p in enumerate(report["pieces"], 1):
        print(
            f"piece {i}: {p['hue']:>7} L*{p['median_lab'][0]:5.1f} C*{p['chroma']:5.1f} valid {p['valid_share']:.2f} "
            f"seam_px {p['seam_px']} glare {p['glare_share']:.3f} warnings {[k for k, v in p['warnings'].items() if v]}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
