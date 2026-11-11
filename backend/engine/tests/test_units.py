"""Unit tests: quality, uncertainty, model plug-in, reference card, segmentation, io."""

import json

import cv2
import numpy as np
import pytest

from silkgrade_engine import config, model, quality, reference_card, segment, uncertainty
from silkgrade_engine.colour import lab_to_srgb, to_lab
from silkgrade_engine.io import load, sha256_file

RNG = np.random.default_rng(0)


# --- quality -----------------------------------------------------------------

def _fabric(h=400, w=600, lab=(50, 30, 10), grain=0.02):
    base = np.empty((h, w, 3)); base[...] = lab
    rgb = lab_to_srgb(base).astype(np.float32)
    return np.clip(rgb + RNG.normal(0, grain, rgb.shape), 0, 1).astype(np.float32)


def test_quality_clean_image_has_no_warnings_except_lowres():
    rgb = _fabric()
    q = quality.check(rgb, to_lab(rgb), full_res_area_px=4e6)
    assert q["warnings"] == {"blur": False, "clipping": False, "glare": False, "lowRes": False}


def test_quality_detects_blur():
    rgb = cv2.GaussianBlur(_fabric(), (0, 0), 4)
    assert quality.check(rgb, to_lab(rgb), full_res_area_px=4e6)["warnings"]["blur"]


def test_quality_detects_clipping():
    rgb = _fabric(lab=(99.5, 0, 0), grain=0.03)
    assert quality.check(rgb, to_lab(rgb), full_res_area_px=4e6)["warnings"]["clipping"]


def test_quality_detects_glare():
    rgb = _fabric()
    cv2.circle(rgb, (300, 200), 25, (1.0, 1.0, 1.0), -1)
    assert quality.check(rgb, to_lab(rgb), full_res_area_px=4e6)["warnings"]["glare"]


def test_quality_low_resolution():
    rgb = _fabric()
    assert quality.check(rgb, to_lab(rgb), full_res_area_px=1e6)["warnings"]["lowRes"]


# --- uncertainty ---------------------------------------------------------------

def test_interval_confidence_levels():
    assert uncertainty.interval(4.0, np.full(200, 4.0))["confidence"] == "HIGH"
    wide = uncertainty.interval(3.0, np.linspace(2.6, 3.4, 200))
    assert wide["confidence"] == "LOW"
    assert wide["ci"][0] <= 3.0 <= wide["ci"][1]


def test_interval_widened_by_warnings_and_residual():
    base = uncertainty.interval(4.0, np.full(200, 4.0))
    w = uncertainty.interval(4.0, np.full(200, 4.0), n_warnings=2, ref_residual_de00=1.0)
    assert w["width"] > base["width"]
    assert w["width"] == pytest.approx(2 * 2 * config.WARNING_CI_PENALTY + 2 * config.REF_RESIDUAL_GRADE_PER_DE, abs=1e-6)


def test_boundary_crossing():
    assert uncertainty.crosses_half_grade_boundary([4.2, 4.3])
    assert not uncertainty.crosses_half_grade_boundary([4.3, 4.7])


def test_bootstrap_paired_on_uniform_patch_is_tight():
    lab_b = np.zeros((100, 100, 3), np.float32); lab_b[...] = (50, 10, 10)
    lab_a = lab_b.copy(); lab_a[..., 0] += 3.4
    mask = np.ones((100, 100), bool)
    from silkgrade_engine.iso_grading import change_rating
    from silkgrade_engine.colour import delta_e_2000
    boot = uncertainty.bootstrap_paired(lab_b, lab_a, mask, lambda b, a: change_rating(float(delta_e_2000(b, a))), n=50)
    assert boot.std() < 1e-6 and boot.mean() == pytest.approx(3.0, abs=0.05)


# --- model plug-in -------------------------------------------------------------

def test_formula_only_default():
    m = model.load_active(None, "m1_change")
    assert m.version == "formula-only"
    assert model.correct(m, {"iso_rating": 3.7}) == (None, 0.0)


def test_linear_json_model(tmp_path):
    spec = {"name": "m1_change", "version": "0.1.0-test", "type": "linear",
            "features": ["iso_rating"], "coef": [1.0], "intercept": 0.25, "residual_std": 0.1}
    p = tmp_path / "m.json"; p.write_text(json.dumps(spec))
    m = model.load_active({"path": str(p), "version": "0.1.0-test"}, "m1_change")
    assert m.version == "0.1.0-test"
    rating, std = model.correct(m, model.flatten_features({}, 3.5))
    assert rating == pytest.approx(3.75) and std == 0.1


def test_broken_model_falls_back_to_formula(tmp_path):
    p = tmp_path / "bad.json"; p.write_text("{not json")
    assert model.load_active({"path": str(p), "version": "x"}, "m2_stain").version == "formula-only"


def test_flatten_features_has_all_names():
    flat = model.flatten_features({"dE_ab": 1.0, "lab_before": [50, 1, 2]}, 4.0, {"fibre": "silk"})
    assert set(flat) == set(model.FEATURE_NAMES)


# --- reference card ------------------------------------------------------------

def _card_image(cast=(1.08, 1.0, 0.9)):
    cols, rows = config.REF_CARD_GRID
    patch = 50
    img = np.full((rows * patch + 40, cols * patch + 40, 3), 0.25, np.float32)
    ref = reference_card.REFERENCE_SRGB_U8 / 255.0
    from silkgrade_engine.colour import linear_to_srgb, srgb_to_linear
    cast_rgb = linear_to_srgb(np.clip(srgb_to_linear(ref) * np.array(cast), 0, 1))
    for i, c in enumerate(cast_rgb):
        r, cc = divmod(i, cols)
        img[20 + r * patch:20 + (r + 1) * patch, 20 + cc * patch:20 + (cc + 1) * patch] = c
    quad = [[20, 20], [20 + cols * patch, 20], [20 + cols * patch, 20 + rows * patch], [20, 20 + rows * patch]]
    return img, quad


def test_reference_card_removes_colour_cast():
    img, quad = _card_image()
    corr = reference_card.fit(reference_card.sample_patches(img, quad))
    assert corr.residual_de00 < 1.5
    corrected = reference_card.apply(img, corr)
    after = reference_card.fit(reference_card.sample_patches(corrected, quad), "linear3x3")
    assert after.residual_de00 <= corr.residual_de00 + 1e-6


# --- segmentation ----------------------------------------------------------------

def test_detect_regions_finds_three_pieces():
    h, w = 600, 900
    lab = np.zeros((h, w, 3)); lab[...] = (35, 0, 0)
    lab[100:500, 60:300] = (50, 40, 20)     # specimen (chromatic)
    lab[100:500, 340:580] = (93, 0, 2)      # adj 1 (white)
    lab[100:500, 620:860] = (94, 0, 1)      # adj 2 (white)
    rgb = lab_to_srgb(lab).astype(np.float32)
    regs = segment.detect_regions(rgb, to_lab(rgb), ["SPECIMEN", "ADJ1", "ADJ2"], 1.0)
    pieces = {r["piece_guess"]: r for r in regs}
    assert set(pieces) == {"SPECIMEN", "ADJ1", "ADJ2"}
    xs = lambda r: np.mean([p[0] for p in r["polygon"]])
    assert xs(pieces["SPECIMEN"]) < 300 and xs(pieces["ADJ1"]) < xs(pieces["ADJ2"])


def test_fabric_mask_keeps_print_motifs():
    lab = np.zeros((300, 300, 3), np.float32); lab[...] = (40, 0, 0)
    lab[30:270, 30:270] = (45, 40, 20)
    lab[100:150, 100:150] = (80, 5, 70)  # light motif must stay part of the fabric
    poly = segment.polygon_mask((300, 300), [[25, 25], [275, 25], [275, 275], [25, 275]])
    fab = segment.fabric_mask(lab, poly)
    assert fab[120, 120] and fab[60, 60] and not fab[27, 27]


# --- io ------------------------------------------------------------------------

def test_load_8bit_and_16bit(tmp_path):
    img = (RNG.uniform(0, 1, (40, 60, 3)) * 65535).astype(np.uint16)
    p16 = tmp_path / "a.tif"; cv2.imwrite(str(p16), img)
    li = load(p16)
    assert li.bit_depth == 16 and li.rgb.shape == (40, 60, 3)
    np.testing.assert_allclose(li.rgb, img[:, :, ::-1] / 65535.0, atol=1e-6)
    p8 = tmp_path / "a.jpg"; cv2.imwrite(str(p8), (img // 257).astype(np.uint8))
    li8 = load(p8)
    assert li8.bit_depth == 8 and li8.sha256 == sha256_file(p8)
