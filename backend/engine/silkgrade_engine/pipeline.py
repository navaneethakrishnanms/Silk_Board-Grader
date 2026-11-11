"""End-to-end grading: ``grade_test(request, output_dir)`` (Section 8.2).

``request`` follows the GradeRequest contract (Section 7). All image paths
must already be absolute/resolved by the caller.
"""

from __future__ import annotations

import math
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from . import __version__ as ENGINE_VERSION
from . import cluster as cluster_mod
from . import config, features, heatmap, iso_grading, model, quality, reference_card, register, segment
from .colour import chroma, delta_e_ab, delta_e_f, delta_lch, smooth, to_lab
from .io import downscale, load
from .uncertainty import bootstrap_independent, bootstrap_paired, crosses_half_grade_boundary, interval


@dataclass
class PieceImage:
    path: str
    rgb: np.ndarray           # analysis scale, possibly colour-corrected
    lab: np.ndarray
    scale: float              # analysis / original
    device: str | None
    sha256: str
    poly: np.ndarray | None = None
    valid: np.ndarray | None = None
    ppmm: float = 1.0
    quality: dict = field(default_factory=dict)
    seg: dict = field(default_factory=dict)
    glare: np.ndarray | None = None


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def hue_name(lab: list[float] | np.ndarray) -> str:
    L, a, b = float(lab[0]), float(lab[1]), float(lab[2])
    C = math.hypot(a, b)
    if C < 8:
        return "white" if L > 80 else "black" if L < 25 else "grey"
    h = math.degrees(math.atan2(b, a)) % 360
    # CIELAB hue angle bins (cyan / teal sit around 190-225°, blue around 225-290°)
    for lim, name in ((20, "pink"), (45, "red"), (70, "orange"), (100, "yellow"), (160, "green"),
                      (225, "teal"), (290, "blue"), (330, "violet"), (350, "magenta"), (361, "pink")):
        if h < lim:
            return name
    return "colour"


def _change_rate(mb: np.ndarray, ma: np.ndarray) -> float:
    v, _ = delta_e_f(mb, ma)
    return iso_grading.change_rating(float(v))


def _stain_rate(mb: np.ndarray, ma: np.ndarray) -> float:
    dE = float(delta_e_ab(mb, ma))
    dL = float(ma[0] - mb[0])
    return iso_grading.stain_rating(dE, dL)


class _Loader:
    """Loads each distinct path once (single-image mode reuses one photo)."""

    def __init__(self):
        self.cache: dict[str, tuple] = {}

    def get(self, path: str):
        if path not in self.cache:
            img = load(path)
            small, s = downscale(img.rgb, config.ANALYSIS_MAX_SIDE)
            self.cache[path] = (img, small, s)
        return self.cache[path]

    @staticmethod
    def _read(path: str):
        img = load(path)
        small, s = downscale(img.rgb, config.ANALYSIS_MAX_SIDE)
        img.rgb = None  # free the full-resolution array early
        return img, small, s

    def preload(self, pool, paths: list[str]) -> None:
        todo = [p for p in dict.fromkeys(paths) if p not in self.cache]
        for p, res in zip(todo, pool.map(self._read, todo)):
            self.cache[p] = res


def _prepare(loader: _Loader, ref: dict, card: reference_card.CardCorrection | None,
             expect_white: bool, detect_seams: bool) -> PieceImage:
    img, small, s = loader.get(ref["path"])
    rgb = reference_card.apply(small, card) if card is not None else small
    lab = to_lab(rgb)
    poly = segment.polygon_mask(lab.shape[:2], ref.get("polygon"), s)
    ppmm = segment.px_per_mm(poly)
    fab = segment.fabric_mask(lab, poly)
    # image-quality checks look at the area that is actually measured (edge band excluded: it can
    # hold paper between frayed threads); the low-resolution check uses the whole fabric area
    core = segment.erode_edges(fab, config.EDGE_ERODE_MM * ppmm)
    core = core if core.sum() >= 0.05 * max(1, fab.sum()) else fab
    q_raw = quality.check(rgb, lab, core, full_res_area_px=float(fab.sum()) / (s * s), expect_white=expect_white)
    valid, seg = segment.clean(lab, poly, ppmm, glare=q_raw["glare_mask"], detect_seams=detect_seams)
    lab_s = smooth(lab, config.SMOOTH_SIGMA_MM * ppmm)
    return PieceImage(path=ref["path"], rgb=rgb, lab=lab_s, scale=s, device=img.device, sha256=img.sha256,
                      poly=poly, valid=valid, ppmm=ppmm,
                      quality={"warnings": q_raw["warnings"], "metrics": q_raw["metrics"]},
                      seg=seg, glare=q_raw["glare_mask"])


def _active_warnings(*pieces: PieceImage) -> list[str]:
    out = []
    for p in pieces:
        for k, v in p.quality["warnings"].items():
            if v and k not in out:
                out.append(k)
        if p.seg.get("valid_share", 1.0) < config.MIN_VALID_FRACTION and "LOW_VALID_AREA" not in out:
            out.append("LOW_VALID_AREA")
    return out


def _decide(final: float, ci: list[float], warnings: list[str], required: float | None,
            registration_failed: bool, placeholder: bool) -> tuple[str, list[str]]:
    reasons = []
    if crosses_half_grade_boundary(ci):
        reasons.append("BOUNDARY")
    if any(w in config.WARNINGS_FORCING_REVIEW for w in warnings):
        reasons.append("WARNING")
    if required is not None and abs(final - required) < config.NEAR_LIMIT_MARGIN:
        reasons.append("NEAR_LIMIT")
    if registration_failed:
        reasons.append("REGISTRATION")
    if placeholder:
        reasons.append("PROVISIONAL")
    return ("REVIEW" if reasons else "AUTO"), reasons


# ---------------------------------------------------------------------------
# main entry
# ---------------------------------------------------------------------------

def grade_test(request: dict, output_dir: str | Path) -> dict:
    t0 = time.perf_counter()
    timings: dict[str, float] = {}
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    fabric_type = request.get("fabric_type", "PLAIN")
    adj_count = int(request.get("adj_count", 2))
    adj_fibres = list(request.get("adj_fibres") or ["silk", "cotton"])
    required = request.get("required") or {}
    req_change = required.get("change")
    req_stain = required.get("stain")
    options = request.get("options") or {}
    stain_stat = options.get("stain_statistic", config.STAIN_STATISTIC_DEFAULT)
    change_rule = options.get("change_rule", config.CHANGE_RULE_DEFAULT)
    pairs = request["pairs"]
    model_specs = options.get("models") or {}
    m_change = model.load_active(model_specs.get("m1_change"), "m1_change")
    m_stain = model.load_active(model_specs.get("m2_stain"), "m2_stain")

    loader = _Loader()
    global_warnings: list[str] = []

    # --- reference card (optional) -----------------------------------------
    cards: dict[str, reference_card.CardCorrection | None] = {"before": None, "after": None}
    ref = request.get("ref_card") or {}
    ref_residual = None
    for side in ("before", "after"):
        r = ref.get(side) if isinstance(ref, dict) else None
        if r and r.get("path") and r.get("polygon"):
            _, small, s = loader.get(r["path"])
            quad = [[x * s, y * s] for x, y in r["polygon"][:4]]
            cards[side] = reference_card.fit(reference_card.sample_patches(small, quad))
    if cards["before"] or cards["after"]:
        ref_residual = max(c.residual_de00 for c in cards.values() if c)
    else:
        global_warnings.append("noRefCard")
    timings["load_ms"] = (time.perf_counter() - t0) * 1000

    # --- pieces -------------------------------------------------------------
    adj_keys = [k for k in ("adj1", "adj2")[:adj_count] if pairs.get(k)]
    jobs = {("specimen", "before"): (pairs["specimen"]["before"], cards["before"], False),
            ("specimen", "after"): (pairs["specimen"]["after"], cards["after"], False)}
    for k in adj_keys:
        jobs[(k, "before")] = (pairs[k]["before"], cards["before"], True)
        jobs[(k, "after")] = (pairs[k]["after"], cards["after"], True)
    # pre-load distinct paths sequentially (cache is not thread-safe), then
    # prepare pieces in parallel: NumPy / OpenCV release the GIL.
    with ThreadPoolExecutor(max_workers=min(6, len(jobs))) as pool:
        loader.preload(pool, [r["path"] for r, _, _ in jobs.values()])
        futs = {key: pool.submit(_prepare, loader, r, c, white, True) for key, (r, c, white) in jobs.items()}
        prepared = {key: f.result() for key, f in futs.items()}
    sb, sa = prepared[("specimen", "before")], prepared[("specimen", "after")]
    adj = {k: (prepared[(k, "before")], prepared[(k, "after")]) for k in adj_keys}
    timings["prepare_ms"] = (time.perf_counter() - t0) * 1000

    def device_differs(b: PieceImage, a: PieceImage) -> bool:
        return bool(b.device and a.device and b.device != a.device)

    if device_differs(sb, sa) or any(device_differs(b, a) for b, a in adj.values()):
        global_warnings.append("DIFFERENT_DEVICE_BEFORE_AFTER")

    # --- registration (specimen) -------------------------------------------
    reg = register.align(sb.rgb, sa.rgb, sb.poly, sa.poly)
    manual = options.get("manual_points")
    if not reg.ok and manual and manual.get("before") and manual.get("after"):
        bp = [[x * sb.scale, y * sb.scale] for x, y in manual["before"]]
        ap = [[x * sa.scale, y * sa.scale] for x, y in manual["after"]]
        reg = register.from_points(bp, ap)
    timings["register_ms"] = (time.perf_counter() - t0) * 1000

    shape_b = sb.lab.shape[:2]
    if reg.ok:
        lab_a_w = register.warp_to_before(sa.lab, reg.H, shape_b)
        valid_a_w = register.warp_to_before(sa.valid, reg.H, shape_b, nearest=True)
        rgb_a_w = register.warp_to_before(sa.rgb, reg.H, shape_b)
        change_mask = sb.valid & valid_a_w
    else:
        global_warnings.append("REGISTRATION_FAILED")
        lab_a_w, rgb_a_w = None, None
        change_mask = sb.valid

    spec_warn = _active_warnings(sb, sa)
    for w in spec_warn:
        if w not in global_warnings:
            global_warnings.append(w)

    grades: list[dict] = []
    common_spec_warn = spec_warn + [w for w in global_warnings if w in ("DIFFERENT_DEVICE_BEFORE_AFTER", "noRefCard")]
    if not reg.ok:
        common_spec_warn.append("REGISTRATION_FAILED")

    # --- colour change --------------------------------------------------------
    change_heat_path = str(out_dir / "heatmap_change.jpg")
    if reg.ok and change_mask.sum() >= 50:
        total = int(change_mask.sum())
        regions: list[tuple[str, str | None, np.ndarray]] = []
        if fabric_type == "PRINTED":
            cl = cluster_mod.print_colours(sb.lab, change_mask)
            for i, m in enumerate(cl.masks):
                if m.sum() < 50:
                    continue
                if i == 0:
                    regions.append(("CHANGE_GROUND", f"ground ({hue_name(cl.centers[i])})", m))
                else:
                    regions.append(("CHANGE_MOTIF", f"motif {i} ({hue_name(cl.centers[i])})", m))
        overall_feats, emap = features.change_features(sb.lab, lab_a_w, change_mask, total)
        heatmap.render(rgb_a_w, emap, config.HEATMAP_MAX_DE_CHANGE, change_heat_path)

        comp: list[dict] = []
        for kind, label, m in regions:
            f, _ = features.change_features(sb.lab, lab_a_w, m, total, de_map=emap)
            iso = iso_grading.change_rating(f["dE_F"])
            boot = bootstrap_paired(sb.lab, lab_a_w, m, _change_rate)
            comp.append({"kind": kind, "label": label, "iso": iso, "features": f, "boot": boot,
                         "swatch_before": f["lab_before"], "swatch_after": f["lab_after"]})

        if fabric_type == "PRINTED" and len(comp) >= 1:
            ratings = np.array([c["iso"] for c in comp])
            shares = np.array([c["features"]["area_share"] for c in comp])
            shares = shares / shares.sum()
            worst_i = int(np.argmin(ratings))
            n = min(len(c["boot"]) for c in comp)
            if change_rule == "worst":
                overall_iso = float(ratings[worst_i])
                overall_boot = comp[worst_i]["boot"]
            else:
                overall_iso = float(np.sum(ratings * shares))
                overall_boot = (np.sum([c["boot"][:n] * w for c, w in zip(comp, shares)], axis=0)
                                if n else np.array([]))
            overall = {"kind": "CHANGE_OVERALL", "label": None, "iso": overall_iso,
                       "features": overall_feats, "boot": overall_boot}
            worst = dict(comp[worst_i])
            worst = {"kind": "CHANGE_WORST", "label": comp[worst_i]["label"], "iso": float(ratings[worst_i]),
                     "features": comp[worst_i]["features"], "boot": comp[worst_i]["boot"]}
            change_items = [overall] + comp + [worst]
        else:
            iso = iso_grading.change_rating(overall_feats["dE_F"])
            boot = bootstrap_paired(sb.lab, lab_a_w, change_mask, _change_rate)
            change_items = [{"kind": "CHANGE_OVERALL", "label": None, "iso": iso,
                             "features": overall_feats, "boot": boot}]
    else:
        # registration failed: compare median colours of the two pieces (no per-pixel map)
        f, emap = features.stain_features(sb.lab, sb.valid, sa.lab, sa.valid)
        dEF, placeholder = delta_e_f(np.array(f["lab_before"]), np.array(f["lab_after"]))
        f["dE_F"] = round(float(dEF), 4)
        f["dE_F_is_placeholder"] = bool(placeholder)
        f["registered"] = False
        iso = iso_grading.change_rating(f["dE_F"])
        boot = bootstrap_independent(sb.lab, sb.valid, sa.lab, sa.valid, _change_rate)
        heatmap.render(sa.rgb, emap, config.HEATMAP_MAX_DE_CHANGE, change_heat_path)
        change_items = [{"kind": "CHANGE_OVERALL", "label": None, "iso": iso, "features": f, "boot": boot}]
    timings["change_ms"] = (time.perf_counter() - t0) * 1000

    ctx_change = {"fibre": "silk", "fabric_type": fabric_type, "n_warnings": len(common_spec_warn)}
    for item in change_items:
        grades.append(_finalise(item, m_change, ctx_change, common_spec_warn, req_change,
                                not reg.ok, ref_residual, change_heat_path))

    # --- staining --------------------------------------------------------------
    stain_grades = []
    for idx, k in enumerate(adj_keys):
        b, a = adj[k]
        f, emap = features.stain_features(b.lab, b.valid, a.lab, a.valid)
        r_median = iso_grading.stain_rating_from_gs(f["dE_gs_median"])
        r_p90 = iso_grading.stain_rating_from_gs(f["dE_gs_p90"])
        f["rating_median"] = round(r_median, 4)
        f["rating_p90"] = round(r_p90, 4)
        f["stain_statistic"] = stain_stat
        iso = r_p90 if stain_stat == "p90" else r_median
        boot = bootstrap_independent(b.lab, b.valid, a.lab, a.valid, _stain_rate)
        hp = str(out_dir / f"heatmap_stain_{k}.jpg")
        heatmap.render(a.rgb, emap, config.HEATMAP_MAX_DE_STAIN, hp)
        w = _active_warnings(b, a) + [x for x in global_warnings if x in ("DIFFERENT_DEVICE_BEFORE_AFTER", "noRefCard")]
        for x in _active_warnings(b, a):
            if x not in global_warnings:
                global_warnings.append(x)
        fibre = adj_fibres[idx] if idx < len(adj_fibres) else None
        item = {"kind": f"STAIN_{k.upper()}", "label": fibre, "iso": iso, "features": f, "boot": boot}
        g = _finalise(item, m_stain, {"fibre": fibre, "fabric_type": fabric_type, "n_warnings": len(w)},
                      w, req_stain, False, ref_residual, hp)
        stain_grades.append(g)
    grades.extend(stain_grades)
    if len(stain_grades) == 2:
        worst = min(stain_grades, key=lambda g: g["final_rating"])
        sw = dict(worst)
        sw["kind"] = "STAIN_WORST"
        sw["label"] = f"worst ({worst['label']})" if worst.get("label") else "worst"
        grades.append(sw)
    timings["stain_ms"] = (time.perf_counter() - t0) * 1000

    model_version = _model_version_string(m_change, m_stain)
    pieces_info = {
        "specimen": {"before": _piece_info(sb), "after": _piece_info(sa)},
        **{k: {"before": _piece_info(b), "after": _piece_info(a)} for k, (b, a) in adj.items()},
    }
    timings["total_ms"] = (time.perf_counter() - t0) * 1000
    return {
        "engine_version": ENGINE_VERSION,
        "model_version": model_version,
        "grades": grades,
        "warnings": global_warnings,
        "registration": reg.as_dict(),
        "ref_card": ({"residual_dE00": round(ref_residual, 3)} if ref_residual is not None else None),
        "pieces": pieces_info,
        "timings_ms": {k: round(v, 1) for k, v in timings.items()},
    }


def _finalise(item: dict, mdl, ctx: dict, warnings: list[str], required, registration_failed: bool,
              ref_residual, heat_path: str) -> dict:
    iso = float(item["iso"])
    feats = dict(item["features"])
    flat = model.flatten_features(feats, iso, ctx)
    model_rating, model_std = model.correct(mdl, flat)
    final = float(model_rating) if model_rating is not None else iso
    unc = interval(final, item["boot"], n_warnings=len([w for w in warnings if w != "noRefCard"]),
                   ref_residual_de00=ref_residual)
    if model_std:
        unc["ci"] = [max(1.0, unc["ci"][0] - model_std), min(5.0, unc["ci"][1] + model_std)]
    placeholder = bool(feats.get("dE_F_is_placeholder", False))
    decision, reasons = _decide(final, unc["ci"], warnings, required, registration_failed, placeholder)
    margin = float(getattr(mdl, "review_margin", 0.0) or 0.0)
    if model_rating is not None and margin > 0 and boundary_distance(final) < margin:
        reasons.append("MODEL_UNCERTAIN")
        decision = "REVIEW"
    half = iso_grading.half_grade(final)
    feats.update({"review_reasons": reasons, "warnings": list(dict.fromkeys(warnings)),
                  "ci_width": unc["width"], "model_name": mdl.name, "model_std": round(model_std, 4)})
    if "swatch_before" in item:
        feats["swatch_before"] = item["swatch_before"]
        feats["swatch_after"] = item["swatch_after"]
    return {
        "kind": item["kind"], "label": item.get("label"),
        "iso_rating": round(iso, 3),
        "model_rating": round(model_rating, 3) if model_rating is not None else None,
        "final_rating": round(final, 3),
        "half_grade": half,
        "grade_label": config.GRADE_LABEL[half],
        "ci": unc["ci"], "confidence": unc["confidence"],
        "decision": decision,
        "pass": (bool(half >= float(required)) if required is not None else None),
        "features": feats,
        "heatmap_path": heat_path,
        "model_version": mdl.version,
    }


def boundary_distance(rating: float) -> float:
    """Distance of a continuous rating to the nearest half-grade rounding boundary (x.25 / x.75)."""
    return 0.25 - abs(((rating - 1.25) % 0.5) - 0.25)


def _model_version_string(m_change, m_stain) -> str:
    if getattr(m_change, "is_formula_only", False) and getattr(m_stain, "is_formula_only", False):
        return config.MODEL_VERSION_FORMULA_ONLY
    return f"{m_change.name}@{m_change.version};{m_stain.name}@{m_stain.version}"


def _piece_info(p: PieceImage) -> dict:
    med = np.median(p.lab[p.valid], axis=0) if p.valid is not None and p.valid.any() else np.zeros(3)
    return {
        "sha256": p.sha256, "device": p.device,
        "warnings": p.quality.get("warnings", {}), "metrics": p.quality.get("metrics", {}),
        "segmentation": p.seg, "px_per_mm": round(p.ppmm / p.scale, 3),
        "median_lab": [round(float(v), 3) for v in med],
    }


def inspect_image(path: str, preview_path: str | None = None, expect_white: bool = False) -> dict:
    """Quick quality inspection of a freshly uploaded image (whole frame)."""
    from .io import save_preview

    img = load(path)
    small, s = downscale(img.rgb, config.ANALYSIS_MAX_SIDE)
    lab = to_lab(small)
    # inspect the central 80 % so the background does not dominate
    h, w = lab.shape[:2]
    m = np.zeros((h, w), dtype=bool)
    m[int(h * 0.1):int(h * 0.9), int(w * 0.1):int(w * 0.9)] = True
    # low-res uses the whole frame here; the per-region check runs at grading
    q = quality.check(small, lab, m, full_res_area_px=float(img.width * img.height),
                      expect_white=expect_white)
    warnings = dict(q["warnings"])
    warnings["noRefCard"] = True  # refined at grading time when a card region is confirmed
    if preview_path:
        save_preview(img.rgb, preview_path)
    return {"width": img.width, "height": img.height, "device": img.device, "bit_depth": img.bit_depth,
            "sha256": img.sha256, "warnings": warnings, "metrics": q["metrics"],
            "preview_path": preview_path}


def detect(path: str, expected_pieces: list[str], background: str | None = None) -> dict:
    img = load(path)
    small, s = downscale(img.rgb, 800)
    lab = to_lab(small)
    mode = segment.background_mode(lab, background)
    regions = segment.detect_regions(small, lab, expected_pieces, s, mode)
    return {"regions": regions, "width": img.width, "height": img.height, "background": mode}


def check_alignment(before: dict, after: dict) -> dict:
    """Specimen before/after registration only (used by the UI alignment step)."""
    loader = _Loader()
    sb_img, sb, s_b = loader.get(before["path"])
    sa_img, sa, s_a = loader.get(after["path"])
    pb = segment.polygon_mask(sb.shape[:2], before.get("polygon"), s_b)
    pa = segment.polygon_mask(sa.shape[:2], after.get("polygon"), s_a)
    reg = register.align(sb, sa, pb, pa)
    return reg.as_dict()


__all__ = ["grade_test", "inspect_image", "detect", "check_alignment", "hue_name", "chroma", "delta_lch"]
