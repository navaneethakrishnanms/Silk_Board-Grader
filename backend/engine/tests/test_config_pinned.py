"""Pins every VERIFY constant. If one of these fails, a constant was changed:
that must be a deliberate decision backed by the purchased ISO standard."""

from silkgrade_engine import config


def test_grade_tables():
    assert config.GRADES == [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0]
    assert config.GRADE_LABEL[4.5] == "4-5" and config.GRADE_LABEL[1.5] == "1-2"


def test_change_scale_pinned():
    assert config.CHANGE_SCALE_DE == {5.0: 0.0, 4.5: 0.8, 4.0: 1.7, 3.5: 2.5, 3.0: 3.4,
                                      2.5: 4.8, 2.0: 6.8, 1.5: 9.6, 1.0: 13.6}


def test_stain_scale_pinned():
    assert config.STAIN_SCALE_DE == {5.0: 0.0, 4.5: 2.2, 4.0: 4.3, 3.5: 6.0, 3.0: 8.5,
                                     2.5: 12.0, 2.0: 16.9, 1.5: 24.0, 1.0: 34.1}


def test_a04_constants_pinned():
    assert (config.A04_CHROMA_WEIGHT, config.A04_LOG_INTERCEPT, config.A04_LOG_SLOPE,
            config.A04_LINEAR_SLOPE, config.A04_LINEAR_SWITCH) == (0.4, 6.1, 1.45, 0.23, 4.0)


def test_a05_constants_pinned():
    assert (config.A05_LINEAR_LIMIT, config.A05_LINEAR_DIVISOR, config.A05_LOG_REF) == (3.4, 1.7, 0.85)


def test_de_f_placeholder_flag():
    # Flip to True only once ISO 105-A05 ΔE_F is implemented and verified.
    assert config.DE_F_VERIFIED is False


def test_thresholds_pinned():
    assert config.CI_HIGH_MAX_WIDTH == 0.25 and config.CI_MEDIUM_MAX_WIDTH == 0.5
    assert config.BOOTSTRAP_N == 200 and config.BOOTSTRAP_PATCH_FRACTION == 0.2
    assert config.NEAR_LIMIT_MARGIN == 0.5
    assert config.EDGE_ERODE_MM == 3.0
