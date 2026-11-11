"""Section 8.7 end-to-end sanity tests on synthetic composites."""

import pytest

from silkgrade_engine import config, grade_test

from .conftest import absolute_request, by_kind


def test_identical_before_after_is_grade_5(graded):
    r = graded["identical_plain"]
    for g in r["grades"]:
        assert g["half_grade"] == 5.0, g["kind"]
    # staining grades carry no placeholder -> AUTO
    for g in by_kind(r, "STAIN_ADJ1") + by_kind(r, "STAIN_ADJ2"):
        assert g["decision"] == "AUTO"
    # colour change is REVIEW only because ΔE_F is still a placeholder
    ch = by_kind(r, "CHANGE_OVERALL")[0]
    assert ch["features"]["review_reasons"] == ["PROVISIONAL"]
    assert ch["features"]["dE_F_is_placeholder"] is True


def test_identical_is_auto_once_de_f_verified(manifest, synthetic_root, tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DE_F_VERIFIED", True)
    r = grade_test(absolute_request(manifest["identical_plain"], synthetic_root), tmp_path)
    assert all(g["decision"] == "AUTO" for g in r["grades"]), [(g["kind"], g["features"]["review_reasons"]) for g in r["grades"]]
    assert all(g["half_grade"] == 5.0 for g in r["grades"])


def test_plain_lightness_shift_3_4_is_grade_3(graded):
    g = by_kind(graded["plain_shift_3_4"], "CHANGE_OVERALL")[0]
    assert g["final_rating"] == pytest.approx(3.0, abs=0.5)
    assert g["features"]["dL"] == pytest.approx(3.4, abs=0.2)
    assert g["features"]["dE_ab"] == pytest.approx(3.4, abs=0.2)


def test_white_stained_8_5_is_grade_3(graded):
    g = by_kind(graded["stained_white_8_5"], "STAIN_ADJ1")[0]
    assert g["final_rating"] == pytest.approx(3.0, abs=0.5)
    assert g["features"]["dE_ab"] == pytest.approx(8.5, abs=0.3)
    worst = by_kind(graded["stained_white_8_5"], "STAIN_WORST")[0]
    assert worst["final_rating"] == g["final_rating"]


def test_printed_only_motif_fades(graded):
    r = graded["printed_motif_fade"]
    ground = by_kind(r, "CHANGE_GROUND")[0]
    motifs = by_kind(r, "CHANGE_MOTIF")
    worst = by_kind(r, "CHANGE_WORST")[0]
    assert ground["final_rating"] >= 4.75
    assert min(m["final_rating"] for m in motifs) < 4.5
    faded = min(motifs, key=lambda m: m["final_rating"])
    assert worst["label"] == faded["label"] and worst["final_rating"] == faded["final_rating"]
    assert "teal" in faded["label"]
    assert by_kind(r, "CHANGE_OVERALL")


def test_shifted_rotated_registers_and_grades_the_same(graded):
    r = graded["shifted_rotated"]
    assert r["registration"]["ok"] is True
    a = by_kind(r, "CHANGE_OVERALL")[0]["final_rating"]
    b = by_kind(graded["plain_shift_3_4"], "CHANGE_OVERALL")[0]["final_rating"]
    assert a == pytest.approx(b, abs=0.15)


def test_clipped_whites_flagged_and_reviewed(graded):
    r = graded["clipped_whites"]
    assert "clipping" in r["warnings"]
    g = by_kind(r, "STAIN_ADJ1")[0]
    assert g["decision"] == "REVIEW" and "WARNING" in g["features"]["review_reasons"]


def test_glare_flagged_and_reviewed(graded):
    r = graded["glare"]
    assert "glare" in r["warnings"]
    g = by_kind(r, "CHANGE_OVERALL")[0]
    assert g["decision"] == "REVIEW" and "WARNING" in g["features"]["review_reasons"]


def test_response_contract_fields(graded):
    r = graded["plain_shift_3_4"]
    assert r["engine_version"] and r["model_version"] == "formula-only"
    for g in r["grades"]:
        for k in ("kind", "label", "iso_rating", "model_rating", "final_rating", "half_grade",
                  "ci", "confidence", "decision", "pass", "features", "heatmap_path"):
            assert k in g
        assert g["model_rating"] is None
        assert g["final_rating"] == g["iso_rating"]
        assert g["ci"][0] <= g["final_rating"] <= g["ci"][1]
        assert g["confidence"] in ("HIGH", "MEDIUM", "LOW")
        for f in ("dE_ab", "dE00", "dL", "dC", "dH", "p10", "p50", "p90", "area_share"):
            assert f in g["features"]


def test_pass_fail_against_required(graded):
    g = by_kind(graded["plain_shift_3_4"], "CHANGE_OVERALL")[0]
    assert g["pass"] is False  # 3 < required 4
    s = by_kind(graded["plain_shift_3_4"], "STAIN_ADJ1")[0]
    assert s["pass"] is True   # 5 >= 3.5


def test_stain_statistic_option(manifest, synthetic_root, tmp_path):
    req = absolute_request(manifest["stained_white_8_5"], synthetic_root)
    req["options"]["stain_statistic"] = "median"
    r = grade_test(req, tmp_path)
    g = by_kind(r, "STAIN_ADJ1")[0]
    assert g["features"]["stain_statistic"] == "median"
    assert g["iso_rating"] == pytest.approx(g["features"]["rating_median"], abs=1e-3)
    assert "rating_p90" in g["features"]


def test_trained_model_version_appears_on_grades(manifest, synthetic_root, tmp_path):
    import json
    spec = {"name": "m1_change", "version": "0.0.1-synthetic", "features": ["iso_rating"],
            "coef": [1.0], "intercept": 0.0, "residual_std": 0.05}
    p = tmp_path / "m1.json"; p.write_text(json.dumps(spec))
    req = absolute_request(manifest["plain_shift_3_4"], synthetic_root)
    req["options"]["models"] = {"m1_change": {"path": str(p), "version": "0.0.1-synthetic"}}
    r = grade_test(req, tmp_path / "out")
    ch = by_kind(r, "CHANGE_OVERALL")[0]
    assert ch["model_version"] == "0.0.1-synthetic" and ch["model_rating"] is not None
    assert "m1_change@0.0.1-synthetic" in r["model_version"]
