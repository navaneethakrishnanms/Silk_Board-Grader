"""All engine constants.

Every value marked ``VERIFY`` must be checked against the purchased ISO
standards (105-A02, A03, A04, A05, A11) before the client relies on results.
Each VERIFY value is pinned by a unit test in ``tests/test_config_pinned.py``
so that a change is always deliberate.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Grade tables
# ---------------------------------------------------------------------------
GRADES = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0]  # class index 0..8
GRADE_LABEL = {
    5.0: "5", 4.5: "4-5", 4.0: "4", 3.5: "3-4", 3.0: "3",
    2.5: "2-3", 2.0: "2", 1.5: "1-2", 1.0: "1",
}

# Nominal CIELAB colour difference per grey-scale step.
# TODO VERIFY against ISO 105-A02 (change) / ISO 105-A03 (staining).
CHANGE_SCALE_DE = {5.0: 0.0, 4.5: 0.8, 4.0: 1.7, 3.5: 2.5, 3.0: 3.4,
                   2.5: 4.8, 2.0: 6.8, 1.5: 9.6, 1.0: 13.6}
STAIN_SCALE_DE = {5.0: 0.0, 4.5: 2.2, 4.0: 4.3, 3.5: 6.0, 3.0: 8.5,
                  2.5: 12.0, 2.0: 16.9, 1.5: 24.0, 1.0: 34.1}

# ---------------------------------------------------------------------------
# ISO 105-A04 staining formula constants — TODO VERIFY
# dE_gs = dE_ab - A04_CHROMA_WEIGHT * sqrt(dE_ab^2 - dL^2)
# SSR   = A04_LOG_INTERCEPT - A04_LOG_SLOPE * ln(dE_gs); if SSR > 4:
# SSR   = 5 - A04_LINEAR_SLOPE * dE_gs
# ---------------------------------------------------------------------------
A04_CHROMA_WEIGHT = 0.4
A04_LOG_INTERCEPT = 6.1
A04_LOG_SLOPE = 1.45
A04_LINEAR_SLOPE = 0.23
A04_LINEAR_SWITCH = 4.0

# ---------------------------------------------------------------------------
# ISO 105-A05 colour change formula constants — TODO VERIFY
# dE_F <= A05_LINEAR_LIMIT : r = 5 - dE_F / A05_LINEAR_DIVISOR
# else                     : r = 5 - log(dE_F / A05_LOG_REF) / log(2)
# ---------------------------------------------------------------------------
A05_LINEAR_LIMIT = 3.4
A05_LINEAR_DIVISOR = 1.7
A05_LOG_REF = 0.85

# ΔE_F is the ISO 105-A05 weighted colour difference. Its exact definition has
# not been verified against the purchased standard, so CIEDE2000 is used as a
# placeholder. While this is False, every colour-change grade carries
# features.dE_F_is_placeholder = True, a "provisional" badge in the UI, and is
# routed to REVIEW.  TODO VERIFY: implement ISO 105-A05 ΔE_F and set True.
DE_F_VERIFIED = False

# ---------------------------------------------------------------------------
# Image quality
# ---------------------------------------------------------------------------
BLUR_MIN = 60.0                 # variance of Laplacian on 8-bit L, analysis scale
CLIP_MAX_FRACTION = 0.005       # > 0.5 % of region pixels at 255 in any channel
CLIP_LEVEL = 254.5 / 255.0
GLARE_L_MIN = 95.0              # L* above this ...
GLARE_C_MAX = 3.0               # ... and C* below this inside fabric = glare
GLARE_MIN_BLOB_FRACTION = 0.0005  # ignore specks smaller than this share of region
LOW_RES_MIN_MP = 3.0            # fabric region must be >= 3 MP-equivalent area

# Warnings that force a REVIEW decision. "noRefCard" is informational only:
# the client may not have a reference card yet (Section 16, Q5).
WARNINGS_FORCING_REVIEW = {"blur", "clipping", "glare", "lowRes",
                           "DIFFERENT_DEVICE_BEFORE_AFTER", "REGISTRATION_FAILED",
                           "LOW_VALID_AREA"}
WARNING_CI_PENALTY = 0.10       # CI widened by this (grade units) per warning

# ---------------------------------------------------------------------------
# Geometry / segmentation
# ---------------------------------------------------------------------------
ANALYSIS_MAX_SIDE = 1600        # images are analysed at most at this long side (px)
SPECIMEN_NOMINAL_MM = (100.0, 40.0)  # ISO 105-C10 composite, used to estimate px/mm
EDGE_ERODE_MM = 3.0
SEAM_BAND_MM = 2.0
SEAM_MIN_LENGTH_FRACTION = 0.6  # a seam must span >= 60 % of the region
SMOOTH_SIGMA_MM = 1.0
FABRIC_BG_MIN_DL = 15.0         # Otsu split kept only if classes differ by >= this L*
MIN_VALID_FRACTION = 0.25       # valid pixels / polygon pixels, else LOW_VALID_AREA

# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------
REGISTRATION_METHOD = "AKAZE"
MIN_INLIERS = 25
RANSAC_REPROJ_PX = 3.0

# ---------------------------------------------------------------------------
# Print clustering
# ---------------------------------------------------------------------------
CLUSTER_K_RANGE = (2, 5)
CLUSTER_SAMPLE = 4000           # pixels sampled for k-means / silhouette
CLUSTER_MIN_SHARE = 0.03        # clusters smaller than this are merged away
CLUSTER_BOUNDARY_ERODE_PX = 2

# ---------------------------------------------------------------------------
# Statistics / uncertainty
# ---------------------------------------------------------------------------
STAIN_STATISTIC_DEFAULT = "p90"   # TODO VERIFY with client (Section 16, Q4)
CHANGE_RULE_DEFAULT = "area_weighted"  # or "worst" — TODO VERIFY with client
STAIN_TILE_GRID = 8             # "most-stained area" = p90 over tile medians
BOOTSTRAP_N = 200
BOOTSTRAP_PATCH_FRACTION = 0.20
BOOTSTRAP_MAX_PIXELS = 20000
BOOTSTRAP_SEED = 1234
CI_HIGH_MAX_WIDTH = 0.25
CI_MEDIUM_MAX_WIDTH = 0.50
REF_RESIDUAL_GRADE_PER_DE = 0.25  # CI widening per ΔE00 of reference-card residual
NEAR_LIMIT_MARGIN = 0.5           # |final - required| < margin -> REVIEW

# ---------------------------------------------------------------------------
# Heat-maps
# ---------------------------------------------------------------------------
HEATMAP_MAX_DE_CHANGE = 10.0
HEATMAP_MAX_DE_STAIN = 15.0
HEATMAP_ALPHA = 0.6

# ---------------------------------------------------------------------------
# Reference card (optional colour correction)
# ---------------------------------------------------------------------------
REF_CARD_NAME = "ColorChecker24 - After November 2014"
REF_CARD_GRID = (6, 4)          # columns x rows
REF_CARD_PATCH_FRACTION = 0.4   # sample the central 40 % of each patch

MODEL_VERSION_FORMULA_ONLY = "formula-only"
