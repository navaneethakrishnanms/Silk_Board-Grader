"""One command from dataset zip to an activatable model with a full report (WP6).

    python -m training.run --dataset dataset.zip --out runs/<timestamp>/
    python -m training.run --dataset dataset.zip --out runs/<ts>/ --final        # evaluate the test set ONCE
    python -m training.run --synthetic 160 --out runs/<ts>/                      # prove the chain on SYNTHETIC data

Steps: unzip -> validate -> build features with the engine -> split by sample (70/15/15, stratified;
5-fold grouped CV when < 300 records) -> train candidates per target (M1 change, M2 staining) ->
select the simplest that beats the ISO baseline -> calibrate the 95 % interval -> tune the review
threshold -> report (markdown + JSON + confusion matrices) -> export the bundle.
The test split is never touched unless --final is given, and --final runs only once per split.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from sklearn.model_selection import GroupKFold

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from silkgrade_engine import __version__ as ENGINE_VERSION  # noqa: E402
from silkgrade_engine.model import FEATURE_NAMES  # noqa: E402
from training import candidates as C  # noqa: E402
from training import evaluation as E  # noqa: E402
from training import splits as S  # noqa: E402
from training.dataset import DatasetError, build_features, dataset_hash, load_and_validate, save_parquet, unzip  # noqa: E402
from training.export import engine_matches_python, write_bundle  # noqa: E402

TARGETS = ("m1_change", "m2_stain")
CV_THRESHOLD = 300
BREAKDOWN_FIELDS = ("fabric_type", "base_shade", "construction", "device")


def log(msg: str) -> None:
    print(msg, flush=True)


def matrix(rows: list[dict]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    X = np.array([[r[f] for f in FEATURE_NAMES] for r in rows], dtype=np.float64)
    y = np.array([r["label"] for r in rows], dtype=np.float64)
    g = np.array([r["sample_id"] for r in rows])
    return X, y, g


def oof_predictions(cls, X, y, groups, n_splits=5) -> np.ndarray:
    """Out-of-fold predictions with folds grouped by sample."""
    pred = np.zeros(len(y))
    k = min(n_splits, len(set(groups)))
    for tr, te in GroupKFold(n_splits=k).split(X, y, groups):
        pred[te] = cls().fit(X[tr], y[tr]).predict(X[te])
    return pred


def run_target(target: str, rows: list[dict], assign: dict, out: Path, final: bool, synthetic: bool, version: str) -> dict:
    trows = [r for r in rows if r["target"] == target]
    required = E.REQUIRED[target]
    if len(trows) < 20:
        return {"target": target, "skipped": f"only {len(trows)} labelled rows"}
    dev = [r for r in trows if assign[r["sample_id"]] in ("train", "val")]
    test = [r for r in trows if assign[r["sample_id"]] == "test"]
    Xd, yd, gd = matrix(dev)
    use_cv = len({r["test_id"] for r in rows}) < CV_THRESHOLD
    if use_cv:
        sel_rows, mode = dev, "5-fold CV grouped by sample on train+val"
        y_sel = yd
        preds = {c.name: oof_predictions(c, Xd, yd, gd) for c in C.ALL}
        preds[C.Baseline.name] = C.Baseline().predict(Xd)
    else:
        tr = [r for r in dev if assign[r["sample_id"]] == "train"]
        va = [r for r in dev if assign[r["sample_id"]] == "val"]
        Xt, yt, _ = matrix(tr)
        Xv, yv, _ = matrix(va)
        sel_rows, mode, y_sel = va, "train -> validation split", yv
        preds = {c.name: c().fit(Xt, yt).predict(Xv) for c in C.ALL}
        preds[C.Baseline.name] = C.Baseline().predict(Xv)

    base_m = E.metrics(y_sel, preds["baseline_iso"], required)
    results = {}
    for name, p in preds.items():
        m = E.metrics(y_sel, p, required)
        m["beats_baseline"] = name != "baseline_iso" and E.beats(m, base_m)
        results[name] = m
    order = sorted(C.ALL, key=lambda c: c.simplicity)
    winner = next((c for c in order if results[c.name]["beats_baseline"]), None)
    chosen = winner.name if winner else "formula-only"

    # calibration + review threshold on validation predictions of the chosen model (or the baseline)
    sel_pred = preds[chosen if winner else "baseline_iso"]
    resid = y_sel - sel_pred
    calib = E.calibrate_interval(sel_pred, y_sel, float(np.std(resid)))
    review = E.tune_review_threshold(sel_pred, y_sel)
    rev_mask = E.boundary_distance(sel_pred) < review["margin"]
    results_chosen = E.metrics(y_sel, sel_pred, required, review=rev_mask)

    # per grade kind and breakdowns (validation predictions)
    per_kind = {}
    for kind in sorted({r["kind"] for r in sel_rows}):
        idx = np.array([r["kind"] == kind for r in sel_rows])
        per_kind[kind] = {name: E.metrics(y_sel[idx], p[idx], required) for name, p in preds.items()}
    breakdowns = {f: E.breakdown(sel_rows, sel_pred, f, required) for f in BREAKDOWN_FIELDS}
    assessors = E.assessor_baseline(sel_rows, required)
    fig_dir = out / "figures"
    figs = {
        name: E.confusion_png(y_sel, p, fig_dir / f"{target}_{name}.png", f"{target} · {name} (validation)")
        for name, p in preds.items()
    }

    summary = {
        "target": target,
        "n_rows": len(trows),
        "n_dev": len(dev),
        "n_test": len(test),
        "selection_mode": mode,
        "candidates": results,
        "chosen": chosen,
        "chosen_metrics_with_review": results_chosen,
        "calibration": calib,
        "review_threshold": review,
        "per_kind": per_kind,
        "breakdowns": breakdowns,
        "assessor_A_vs_B": assessors,
        "figures": {k: Path(v).relative_to(out).as_posix() for k, v in figs.items()},
    }

    if winner:
        model = winner().fit(Xd, yd)  # refit on train+val
        res_sd = float(np.std(yd - model.predict(Xd))) if not use_cv else float(np.std(resid))
        meta = {
            "metrics": {"validation": results[chosen], "baseline_validation": base_m, "assessor_A_vs_B": assessors},
            "residual_std": round(res_sd, 4),
            "interval_z": calib["z"],
            "review_margin": review["margin"],
            "data_hash": rows[0].get("_data_hash"),
            "split_hash": rows[0].get("_split_hash"),
            "engine_version": ENGINE_VERSION,
            "synthetic": synthetic,
            "trained_on_rows": len(dev),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        bundle = write_bundle(out / "model" / target, target, model, version, meta)
        Xchk = Xd[: min(200, len(Xd))]
        summary["export"] = {
            "dir": (out / "model" / target).relative_to(out).as_posix(),
            "type": bundle["type"],
            "engine_vs_python_max_abs_diff": engine_matches_python(bundle, model, Xchk),
        }
        final_model = model
    else:
        summary["export"] = None
        final_model = C.Baseline()

    if final:
        Xte, yte, _ = matrix(test)
        p = final_model.predict(Xte) if len(test) else np.array([])
        rm = E.boundary_distance(p) < review["margin"] if len(test) else None
        summary["test"] = {
            "model": E.metrics(yte, p, required, review=rm) if len(test) else {"n": 0},
            "baseline": E.metrics(yte, C.Baseline().predict(Xte), required) if len(test) else {"n": 0},
            "assessor_A_vs_B": E.assessor_baseline(test, required),
        }
    return summary


def fmt(m: dict | None, keys=("n", "exact", "within_half", "qwk", "mae", "pass_fail_agreement", "review_rate")) -> str:
    if not m:
        return "—"
    return " | ".join("—" if m.get(k) is None else (f"{m[k]:.3f}" if isinstance(m[k], float) else str(m[k])) for k in keys)


def write_report(out: Path, info: dict, summaries: list[dict], final: bool) -> None:
    syn = info["synthetic"]
    title = "SYNTHETIC — not real accuracy" if syn else "SilkGrade model training report"
    L = [f"# {title}", ""]
    if syn:
        L += [
            "> **SYNTHETIC — not real accuracy.** These numbers come from simulated assessors on synthetic images. "
            "They prove the pipeline runs end to end; they say nothing about grading real silk.",
            "",
        ]
    L += [
        f"- Run: `{out}`  ·  created {info['created_at']}",
        f"- Dataset: {info['dataset']}  ·  records {info['records']}  ·  data hash `{info['data_hash'][:12]}`",
        f"- Split: `{info['split_hash']}` (by sample, stratified, 70/15/15) · engine {ENGINE_VERSION}",
        f"- Feature table: `features.parquet` ({info['feature_rows']} rows, {len(FEATURE_NAMES)} features)",
        "",
    ]
    cols = "n | exact | ±0.5 | QWK | MAE | pass/fail | review"
    for s in summaries:
        if s.get("skipped"):
            L += [f"## {s['target']}", f"Skipped: {s['skipped']}", ""]
            continue
        L += [
            f"## {s['target']} — {s['n_rows']} labelled rows",
            f"Selection: {s['selection_mode']}. Rule: weighted kappa above the ISO baseline "
            "and ±0.5 agreement not lower; the simplest such model is kept.",
            "",
            f"| model | {cols} | beats baseline |",
            "|---|---|---|---|---|---|---|---|---|",
        ]
        for name, m in s["candidates"].items():
            L.append(f"| {name} | {fmt(m)} | {'yes' if m.get('beats_baseline') else '—'} |")
        aa = s["assessor_A_vs_B"]
        L.append(f"| *assessor A vs B* | {fmt(aa)} | |")
        L += [
            "",
            f"**Chosen: `{s['chosen']}`**"
            + ("" if s["chosen"] != "formula-only" else " — no candidate beat the ISO formula; ship formula-only."),
            "",
        ]
        c = s["calibration"]
        L += [
            f"- 95 % interval: residual σ {c['sigma']}, coverage at z=1.96 {c['coverage_at_1_96']:.1%} "
            f"-> tuned z={c['z']} gives {c['coverage_tuned']:.1%}"
        ]
        r = s["review_threshold"]
        L += [
            f"- Review threshold: REVIEW when within {r['margin']} of a half-grade boundary "
            f"-> review rate {r['review_rate']:.1%}, "
            f"auto-accepted ±0.5 agreement {r['auto_within_half'] if r['auto_within_half'] is not None else '—'} "
            f"({'meets' if r['meets_review_target'] else 'does NOT meet'} the ≤20 % review / ≥95 % target)"
        ]
        if s.get("export"):
            e = s["export"]
            L += [
                f"- Exported `{e['type']}` bundle to `{e['dir']}/bundle.json` (upload in Settings → Models). "
                f"Engine runtime vs Python max |diff| = {e['engine_vs_python_max_abs_diff']:.2e}"
            ]
        L += ["", "### Per grade kind (validation)", "", f"| kind | model | {cols} |", "|---|---|---|---|---|---|---|---|---|"]
        for kind, ms in s["per_kind"].items():
            for name in ("baseline_iso", s["chosen"]) if s["chosen"] != "formula-only" else ("baseline_iso",):
                L.append(f"| {kind} | {name} | {fmt(ms[name])} |")
        L += ["", "### Breakdown of the chosen model (validation)", ""]
        for f_, groups in s["breakdowns"].items():
            L.append(
                f"**{f_}**: " + "; ".join(f"{g}: n={m['n']}, ±0.5 {m['within_half']}, QWK {m['qwk']}" for g, m in groups.items())
            )
            L.append("")
        L += ["### Confusion matrices", ""] + [f"![{k}]({v})" for k, v in s["figures"].items()] + [""]
    (out / "report.md").write_text("\n".join(L), encoding="utf-8")
    (out / "report.json").write_text(json.dumps({"info": info, "targets": summaries}, indent=2, default=str), encoding="utf-8")

    if final:
        T = [
            f"# {'SYNTHETIC — not real accuracy · ' if syn else ''}TEST SET REPORT (locked)",
            "",
            f"Split `{info['split_hash']}` — evaluated once. Do not tune anything on these numbers.",
            "",
            f"| target | model | {cols} |",
            "|---|---|---|---|---|---|---|---|---|",
        ]
        for s in summaries:
            if s.get("test"):
                T.append(f"| {s['target']} | {s['chosen']} | {fmt(s['test']['model'])} |")
                T.append(f"| {s['target']} | baseline_iso | {fmt(s['test']['baseline'])} |")
                T.append(f"| {s['target']} | assessor A vs B | {fmt(s['test']['assessor_A_vs_B'])} |")
        (out / "test_report.md").write_text("\n".join(T), encoding="utf-8")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--dataset", help="dataset.zip exported from the app (Section 10.2)")
    src.add_argument("--synthetic", type=int, metavar="N", help="build a SYNTHETIC dataset with N records and use it")
    ap.add_argument("--out", required=True, help="run folder, e.g. runs/2026-11-11_1200")
    ap.add_argument("--final", action="store_true", help="also evaluate the locked test split (once per split)")
    ap.add_argument("--new-split", action="store_true", help="draw a new split (required to run --final again)")
    ap.add_argument("--seed", type=int, default=13)
    ap.add_argument("--workers", type=int, default=None)
    ap.add_argument("--version", default=None)
    a = ap.parse_args(argv)

    t0 = time.time()
    out = Path(a.out)
    runs_root = out.parent
    out.mkdir(parents=True, exist_ok=True)
    try:
        if a.synthetic:
            from training.synthetic_dataset import build

            zip_path = runs_root / f"synthetic_dataset_{a.synthetic}.zip"
            if not zip_path.exists():
                log(f"[1/8] building SYNTHETIC dataset ({a.synthetic} records) -> {zip_path}")
                build(zip_path, a.synthetic)
        else:
            zip_path = Path(a.dataset)
        log(f"[1/8] unzip {zip_path}")
        work = out / "work"
        if work.exists():
            shutil.rmtree(work)
        root = unzip(zip_path, work)
        log("[2/8] validate")
        records, synthetic = load_and_validate(root)
        data_hash = dataset_hash(records)
        log(f"      {len(records)} records OK{' (SYNTHETIC)' if synthetic else ''}")
        log("[3/8] build features with the engine")
        rows = build_features(records, work, runs_root / "feature_cache", a.workers, log)
        save_parquet(rows, out / "features.parquet")
        log("[4/8] split by sample")
        split = S.load_or_create(runs_root, rows, data_hash, a.new_split, a.seed)
        S.validate(rows, split["assign"])
        if a.final:
            S.check_final_lock(runs_root, split, a.new_split)
        for r in rows:
            r["_data_hash"], r["_split_hash"] = data_hash, split["hash"]
        counts = {k: sum(1 for v in split["assign"].values() if v == k) for k in ("train", "val", "test")}
        log(f"      split {split['hash']}: samples {counts}")
        version = a.version or datetime.now(timezone.utc).strftime("%Y.%m.%d-%H%M") + ("-synthetic" if synthetic else "")
        summaries = []
        for t in TARGETS:
            log(f"[5/8] train + evaluate {t}")
            summaries.append(run_target(t, rows, split["assign"], out, a.final, synthetic, version))
            s = summaries[-1]
            if not s.get("skipped"):
                log(
                    f"      chosen: {s['chosen']}  (baseline QWK {s['candidates']['baseline_iso']['qwk']}, "
                    f"chosen QWK {s['candidates'].get(s['chosen'], s['candidates']['baseline_iso'])['qwk']})"
                )
        log("[6/8] calibration + review thresholds done")
        info = {
            "synthetic": synthetic,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "dataset": str(zip_path),
            "records": len(records),
            "data_hash": data_hash,
            "split_hash": split["hash"],
            "feature_rows": len(rows),
            "version": version,
            "seconds": round(time.time() - t0, 1),
        }
        log("[7/8] write report")
        write_report(out, info, summaries, a.final)
        if a.final:
            S.record_final(runs_root, split, out)
        shutil.rmtree(work, ignore_errors=True)
        log(f"[8/8] done in {time.time() - t0:.0f}s -> {out / 'report.md'}" + (" and test_report.md" if a.final else ""))
        return 0
    except (DatasetError, S.SplitError) as e:
        log(f"ERROR: {e}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
