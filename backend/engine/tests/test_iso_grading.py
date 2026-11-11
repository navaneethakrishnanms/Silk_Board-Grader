"""Section 8.7 sanity tables for ISO 105-A04 / A05 formulas."""

import pytest

from silkgrade_engine import config
from silkgrade_engine.iso_grading import change_rating, grade_label, half_grade, stain_dE_gs, stain_rating


@pytest.mark.parametrize("grade,de", sorted(config.STAIN_SCALE_DE.items()))
def test_stain_rating_on_grey_scale_steps(grade, de):
    # neutral difference: ΔL = ΔE
    assert stain_rating(de, de) == pytest.approx(grade, abs=0.15)


@pytest.mark.parametrize("grade,de", sorted(config.CHANGE_SCALE_DE.items()))
def test_change_rating_on_grey_scale_steps(grade, de):
    assert change_rating(de) == pytest.approx(grade, abs=0.15)


def test_change_rating_exact_points():
    assert change_rating(3.4) == pytest.approx(3.0, abs=1e-9)
    assert change_rating(13.6) == pytest.approx(1.0, abs=1e-9)
    assert change_rating(0.0) == 5.0


def test_ratings_are_clamped():
    assert change_rating(500.0) == 1.0
    assert stain_rating(500.0, 500.0) == 1.0
    assert stain_rating(0.0, 0.0) == 5.0


def test_ratings_monotonic():
    xs = [i * 0.25 for i in range(1, 160)]
    ch = [change_rating(x) for x in xs]
    st = [stain_rating(x, x) for x in xs]
    assert all(a >= b for a, b in zip(ch, ch[1:]))
    assert all(a >= b for a, b in zip(st, st[1:]))


def test_chroma_weighting_in_staining():
    # a pure-chroma stain counts less than a lightness stain of equal ΔE
    assert stain_dE_gs(5.0, 0.0) == pytest.approx(3.0)
    assert stain_dE_gs(5.0, 5.0) == pytest.approx(5.0)
    assert stain_rating(5.0, 0.0) > stain_rating(5.0, 5.0)


@pytest.mark.parametrize("r,h,label", [(4.74, 4.5, "4-5"), (4.75, 5.0, "5"), (4.25, 4.5, "4-5"),
                                       (4.24, 4.0, "4"), (1.1, 1.0, "1"), (2.5, 2.5, "2-3")])
def test_half_grade_rounding(r, h, label):
    assert half_grade(r) == h
    assert grade_label(r) == label
