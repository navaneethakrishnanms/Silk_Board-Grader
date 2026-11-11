"""Colour conversions against colour-science reference values."""

import numpy as np
import pytest

from silkgrade_engine import colour as C

colour = pytest.importorskip("colour")

RNG = np.random.default_rng(42)


def ref_lab(rgb):
    xyz = colour.RGB_to_XYZ(rgb, colour.RGB_COLOURSPACES["sRGB"], apply_cctf_decoding=True)
    return colour.XYZ_to_Lab(xyz, colour.CCS_ILLUMINANTS["CIE 1931 2 Degree Standard Observer"]["D65"])


def test_srgb_to_lab_matches_colour_science():
    rgb = RNG.uniform(0, 1, (500, 3))
    ours = C.xyz_to_lab(C.linear_to_xyz(C.srgb_to_linear(rgb)))
    np.testing.assert_allclose(ours, ref_lab(rgb), atol=2e-3)


def test_fast_path_matches_exact_path():
    img = RNG.uniform(0, 1, (200, 200, 3)).astype(np.float32)
    fast = C.to_lab(img)  # large -> float32 path
    exact = C.xyz_to_lab(C.linear_to_xyz(C.srgb_to_linear(img.astype(np.float64))))
    assert np.max(np.abs(fast - exact)) < 5e-3


def test_known_values():
    np.testing.assert_allclose(C.to_lab(np.array([1.0, 1.0, 1.0])), [100.0, 0.0, 0.0], atol=0.02)
    np.testing.assert_allclose(C.to_lab(np.array([0.0, 0.0, 0.0])), [0.0, 0.0, 0.0], atol=1e-6)
    # sRGB red ≈ (53.24, 80.09, 67.20)
    np.testing.assert_allclose(C.to_lab(np.array([1.0, 0.0, 0.0])), [53.24, 80.09, 67.20], atol=0.05)


def test_lab_roundtrip():
    rgb = RNG.uniform(0.02, 0.98, (300, 3))
    lab = C.xyz_to_lab(C.linear_to_xyz(C.srgb_to_linear(rgb)))
    np.testing.assert_allclose(C.lab_to_srgb(lab), rgb, atol=1e-6)


def test_delta_e_ab_matches_colour_science():
    a = RNG.uniform([0, -60, -60], [100, 60, 60], (300, 3))
    b = RNG.uniform([0, -60, -60], [100, 60, 60], (300, 3))
    np.testing.assert_allclose(C.delta_e_ab(a, b), colour.delta_E(a, b, method="CIE 1976"), atol=1e-9)


def test_delta_e_2000_matches_colour_science():
    a = RNG.uniform([0, -80, -80], [100, 80, 80], (1000, 3))
    b = a + RNG.normal(0, 4, (1000, 3))
    np.testing.assert_allclose(C.delta_e_2000(a, b), colour.delta_E(a, b, method="CIE 2000"), atol=1e-6)


@pytest.mark.parametrize("l1,l2,expected", [
    # Sharma, Wu & Dalal (2005) test data
    ((50.0, 2.6772, -79.7751), (50.0, 0.0, -82.7485), 2.0425),
    ((50.0, 3.1571, -77.2803), (50.0, 0.0, -82.7485), 2.8615),
    ((50.0, 2.5, 0.0), (73.0, 25.0, -18.0), 27.1492),
    ((60.2574, -34.0099, 36.2677), (60.4626, -34.1751, 39.4387), 1.2644),
    ((22.7233, 20.0904, -46.6940), (23.0331, 14.9730, -42.5619), 2.0373),
])
def test_delta_e_2000_sharma(l1, l2, expected):
    assert C.delta_e_2000(np.array(l1), np.array(l2)) == pytest.approx(expected, abs=1e-4)


def test_delta_lch_decomposition():
    a = RNG.uniform([20, -50, -50], [90, 50, 50], (200, 3))
    b = a + RNG.normal(0, 3, (200, 3))
    dL, dC, dH = C.delta_lch(a, b)
    np.testing.assert_allclose(dL ** 2 + dC ** 2 + dH ** 2, C.delta_e_ab(a, b) ** 2, rtol=1e-9, atol=1e-9)
    np.testing.assert_allclose(dC, np.hypot(b[:, 1], b[:, 2]) - np.hypot(a[:, 1], a[:, 2]))


def test_delta_e_f_placeholder_is_ciede2000():
    a, b = np.array([50.0, 20.0, 10.0]), np.array([52.0, 18.0, 12.0])
    v, placeholder = C.delta_e_f(a, b)
    assert placeholder is True
    assert v == pytest.approx(C.delta_e_2000(a, b))
