"""WP6: training pipeline — dataset validation, sample-level splits, exports (ONNX == Python), end-to-end run + test lock."""

import json
import shutil
import zipfile
from pathlib import Path

import numpy as np
import pytest

from silkgrade_engine.model import FEATURE_NAMES, from_spec, load_active
from training import candidates as C
from training import splits as S
from training.common import synthetic_table
from training.dataset import DatasetError, load_and_validate, unzip
from training.export import engine_matches_python, write_bundle
from training.synthetic_dataset import META_COLUMNS, build


@pytest.fixture(scope="module")
def small_zip(tmp_path_factory) -> Path:
    return build(tmp_path_factory.mktemp("ds") / "dataset.zip", n_records=24, seed=3, size=(320, 240))


def _xy(target="m1_change", n=400, seed=0):
    rows = [r for r in synthetic_table(n, seed) if (r["kind"].startswith("CHANGE") == (target == "m1_change"))]
    X = np.array([[float(r.get(f, 0.0)) for f in FEATURE_NAMES] for r in rows])
    y = np.array([r["label"] for r in rows])
    return X, y


# --- dataset ---------------------------------------------------------------------


def test_synthetic_zip_matches_export_layout(small_zip):
    with zipfile.ZipFile(small_zip) as z:
        names = z.namelist()
        header = z.read("dataset/metadata.csv").decode().splitlines()[0].split(",")
    assert "dataset/metadata.csv" in names and "dataset/splits.csv" in names
    rec = sorted({n.split("/")[2] for n in names if n.startswith("dataset/records/")})[0]
    for f in (
        "specimen_before.png",
        "specimen_after.png",
        "adj1_before.png",
        "adj1_after.png",
        "adj2_before.png",
        "adj2_after.png",
        "regions.json",
        "features.json",
        "labels.json",
    ):
        assert f"dataset/records/{rec}/{f}" in names
    assert header == META_COLUMNS


def test_validation_passes_and_flags_synthetic(small_zip, tmp_path):
    records, synthetic = load_and_validate(unzip(small_zip, tmp_path))
    assert len(records) == 24 and synthetic is True


def _corrupt(src: Path, dst: Path, drop: str | None = None, edit=None) -> Path:
    with zipfile.ZipFile(src) as zi, zipfile.ZipFile(dst, "w") as zo:
        for n in zi.namelist():
            if drop and n.endswith(drop) and drop not in getattr(_corrupt, "done", set()):
                _corrupt.done = {drop}
                continue
            data = zi.read(n)
            if edit and n.endswith("labels.json") and not getattr(_corrupt, "edited", False):
                data = edit(data)
                _corrupt.edited = True
            zo.writestr(n, data)
    return dst


def test_validation_reports_missing_image(small_zip, tmp_path):
    _corrupt.done = set()
    bad = _corrupt(small_zip, tmp_path / "bad.zip", drop="adj1_after.png")
    with pytest.raises(DatasetError, match="adj1_after.* is missing"):
        load_and_validate(unzip(bad, tmp_path / "x"))


def test_validation_reports_grade_outside_scale(small_zip, tmp_path):
    _corrupt.edited = False

    def edit(data):
        d = json.loads(data)
        d["grades"]["CHANGE_OVERALL"]["assessor_A"] = 3.7
        return json.dumps(d).encode()

    bad = _corrupt(small_zip, tmp_path / "bad2.zip", edit=edit)
    with pytest.raises(DatasetError, match="3.7 is not one of the 9 grades"):
        load_and_validate(unzip(bad, tmp_path / "y"))


# --- splits ---------------------------------------------------------------------


def test_split_is_by_sample_and_stratified():
    rows = [
        {"sample_id": f"S{i // 2}", "test_id": f"T{i}", "target": "m1_change", "label": [2.0, 3.0, 4.0, 5.0][i % 4]}
        for i in range(400)
    ]
    assign = S.make_split(rows, seed=1)
    S.validate(rows, assign)
    share = {k: sum(v == k for v in assign.values()) / len(assign) for k in ("train", "val", "test")}
    assert abs(share["train"] - 0.70) < 0.03 and abs(share["val"] - 0.15) < 0.03 and abs(share["test"] - 0.15) < 0.03
    assert S.make_split(rows, seed=1) == assign  # deterministic


def test_split_validation_rejects_sample_in_two_splits():
    rows = [{"sample_id": "S1", "test_id": "a"}, {"sample_id": "S1", "test_id": "b"}]
    S.validate(rows, {"S1": "train"})
    with pytest.raises(S.SplitError, match="no split"):
        S.validate([{"sample_id": "S9", "test_id": "c"}], {"S1": "train"})


# --- candidates / export -----------------------------------------------------------


@pytest.mark.parametrize("cls", [C.Linear, C.OrdinalLogistic, C.LgbmRegressor, C.LgbmOrdinal])
def test_engine_runtime_equals_python(cls, tmp_path):
    X, y = _xy()
    cand = cls().fit(X, y)
    bundle = write_bundle(
        tmp_path / cls.name,
        "m1_change",
        cand,
        "0.0.1-test",
        {"residual_std": 0.3, "interval_z": 1.96, "review_margin": 0.05, "synthetic": True},
    )
    assert engine_matches_python(bundle, cand, X[:150]) <= 1e-6
    assert (tmp_path / cls.name / "metadata.json").exists()
    if cls.name.startswith("lgbm"):
        assert any(f.startswith("model.onnx") for f in bundle["model_files"])
    # the uploadable bundle.json loads through the same path the API uses
    m = load_active({"path": str(tmp_path / cls.name / "bundle.json"), "version": "0.0.1-test"}, "m1_change")
    assert m.version == "0.0.1-test" and not getattr(m, "is_formula_only", False)
    assert m.review_margin == 0.05


def test_candidates_beat_baseline_when_assessors_have_a_bias():
    from training.evaluation import beats, metrics

    X, y = _xy(n=600, seed=4)
    Xv, yv = _xy(n=300, seed=5)
    base = metrics(yv, C.Baseline().predict(Xv), 4.0)
    lin = metrics(yv, C.Linear().fit(X, y).predict(Xv), 4.0)
    assert lin["mae"] <= base["mae"] + 1e-9
    assert isinstance(beats(lin, base), bool)


def test_from_spec_rejects_unknown_type():
    with pytest.raises(ValueError):
        from_spec({"type": "mystery", "name": "m1_change", "version": "1"})


# --- end to end ---------------------------------------------------------------------


def test_run_end_to_end_and_final_lock(small_zip, tmp_path):
    from training.run import main

    runs = tmp_path / "runs"
    shutil.copy(small_zip, tmp_path / "d.zip")
    assert main(["--dataset", str(tmp_path / "d.zip"), "--out", str(runs / "r1"), "--workers", "2"]) == 0
    rep = (runs / "r1" / "report.md").read_text(encoding="utf-8")
    assert rep.startswith("# SYNTHETIC — not real accuracy")
    assert (runs / "r1" / "features.parquet").exists() and (runs / "r1" / "report.json").exists()
    assert not (runs / "r1" / "test_report.md").exists()  # test split untouched without --final
    info = json.loads((runs / "r1" / "report.json").read_text())
    for t in info["targets"]:
        if not t.get("skipped"):
            assert "test" not in t and "assessor_A_vs_B" in t and t["calibration"]["coverage_tuned"] >= 0.95 - 1e-9

    assert main(["--dataset", str(tmp_path / "d.zip"), "--out", str(runs / "r2"), "--final"]) == 0
    assert "TEST SET REPORT (locked)" in (runs / "r2" / "test_report.md").read_text(encoding="utf-8")
    # a second --final on the same split is refused ...
    assert main(["--dataset", str(tmp_path / "d.zip"), "--out", str(runs / "r3"), "--final"]) == 2
    # ... unless a new split is drawn
    assert main(["--dataset", str(tmp_path / "d.zip"), "--out", str(runs / "r4"), "--final", "--new-split"]) == 0
