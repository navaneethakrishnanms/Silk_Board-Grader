"""WP4: white-paper segmentation, stitched pieces, white-fabric glare, print clusters, grey-scale card check."""

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

from silkgrade_engine import cluster, quality, segment
from silkgrade_engine.colour import to_lab
from silkgrade_engine.io import downscale, load
from silkgrade_engine.pipeline import hue_name

ENGINE = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def standins(tmp_path_factory):
    out = tmp_path_factory.mktemp("standins")
    subprocess.run([sys.executable, str(ENGINE / "tools" / "make_client_standins.py"), "--out", str(out)], check=True)
    return out


@pytest.fixture(scope="module")
def sheet(standins):
    img = load(standins / "fabric_sheet.png")
    small, s = downscale(img.rgb, 1600)
    return small, to_lab(small), s, json.loads((standins / "truth.json").read_text())["fabric_sheet"]


def test_white_background_is_recognised(sheet):
    _, lab, _, _ = sheet
    assert segment.background_mode(lab) == "white"
    assert segment.background_mode(lab, "grey") == "grey"


def test_all_four_pieces_found_on_white_paper_including_white_satin(sheet):
    small, lab, s, truth = sheet
    regs = segment.detect_regions(small, lab, ["SPECIMEN", "ADJ1", "ADJ2", "REF_CARD"], 1.0, "white")
    assert len(regs) == 4
    masks = [segment.polygon_mask(lab.shape[:2], r["polygon"], 1.0) for r in regs]
    for name, rect in truth.items():
        x0, y0 = (np.array(rect[0]) * s).astype(int)
        x1, y1 = (np.array(rect[2]) * s).astype(int)
        best = max(m[y0:y1, x0:x1].mean() for m in masks)
        assert best > 0.85, f"{name} not covered by any detected piece"


def test_stitched_strips_are_split(sheet):
    """The white satin strip is sewn to the light-blue strip: two pieces, not one."""
    small, lab, s, truth = sheet
    regs = segment.detect_regions(small, lab, ["SPECIMEN", "ADJ1", "ADJ2", "REF_CARD"], 1.0, "white")
    centres = [np.mean(np.array(r["polygon"])[:, 0]) / s for r in regs]
    xm = truth["adj_white_satin"][1][0]
    assert any(truth["adj_white_satin"][0][0] < c < xm for c in centres)
    assert any(xm < c < truth["adj_light_blue"][1][0] for c in centres)


def test_white_satin_glare_masks_highlights_not_the_strip(sheet):
    _, lab, s, truth = sheet
    (x0, y0), _, (x1, y1), _ = (np.array(truth["adj_white_satin"]) * s).astype(int)
    m = np.zeros(lab.shape[:2], bool)
    m[y0 + 10 : y1 - 10, x0 + 10 : x1 - 10] = True
    g = quality.glare_mask_white(lab, m)
    share = g.sum() / m.sum()
    assert 0.01 < share < 0.15  # the 5 sheen highlights, not the whole strip
    assert quality.glare_mask(lab, m).sum() / m.sum() > share  # the absolute rule over-masks white satin


def test_frayed_threads_and_paper_are_excluded(sheet):
    small, lab, s, truth = sheet
    (x0, y0), _, (x1, y1), _ = (np.array(truth["specimen_printed"]) * s).astype(int)
    poly = np.zeros(lab.shape[:2], bool)
    poly[y0 - 25 : y1 + 25, x0 - 25 : x1 + 25] = True  # generous polygon reaching onto paper + threads
    valid, _ = segment.clean(lab, poly, segment.px_per_mm(poly))
    inside = np.zeros_like(poly)
    inside[y0:y1, x0:x1] = True
    assert (valid & ~inside).sum() == 0


def test_printed_piece_separates_ground_motif_and_stems(sheet):
    _, lab, s, truth = sheet
    (x0, y0), _, (x1, y1), _ = (np.array(truth["specimen_printed"]) * s).astype(int)
    m = np.zeros(lab.shape[:2], bool)
    m[y0 + 15 : y1 - 15, x0 + 15 : x1 - 15] = True
    cl = cluster.print_colours(lab, m)
    names = [hue_name(c) for c in cl.centers]
    assert cl.k == 3 and names[0] == "teal" and "green" in names
    assert cl.centers[0][0] > 70 and min(c[0] for c in cl.centers) < 50  # light ground, dark motif


def test_grey_scale_check_recovers_nominal_steps(standins, tmp_path):
    out = tmp_path / "check.md"
    for kind in ("change", "staining"):
        subprocess.run(
            [
                sys.executable,
                str(ENGINE / "tools" / "measure_grey_scale.py"),
                "--kind",
                kind,
                "--images",
                str(standins / f"grey_scale_{kind}_p1.png"),
                str(standins / f"grey_scale_{kind}_p2.png"),
                "--out",
                str(out),
                "--append",
            ],
            check=True,
            capture_output=True,
        )
    text = out.read_text(encoding="utf-8")
    assert text.count("— 9 pairs") == 2
    errs = [
        abs(float(line.split("|")[-2]))
        for line in text.splitlines()
        if line.startswith("| ") and line.count("|") == 8 and "step" not in line
    ]
    assert len(errs) == 18 and max(errs) <= 0.2
