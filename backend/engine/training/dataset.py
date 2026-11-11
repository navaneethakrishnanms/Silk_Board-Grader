"""Dataset loading, validation and feature building (WP6 steps 1, 2, 5).

* unzip dataset.zip (brief Section 10.2 layout)
* validate: required images present, every grade one of the 9 values, regions present
* build the feature table by running the grading ENGINE on each record's images and regions
  (features.json from the export is ignored, so features always match the current engine)
"""

from __future__ import annotations

import csv
import hashlib
import json
import os
import zipfile
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

from silkgrade_engine import __version__ as ENGINE_VERSION
from silkgrade_engine.config import GRADES
from silkgrade_engine.model import FEATURE_NAMES, flatten_features

CHANGE_KINDS = ("CHANGE_OVERALL", "CHANGE_GROUND", "CHANGE_WORST")
STAIN_KINDS = ("STAIN_ADJ1", "STAIN_ADJ2", "STAIN_WORST")
TARGET_KINDS = {"m1_change": CHANGE_KINDS, "m2_stain": STAIN_KINDS}
IMAGE_EXT = (".jpg", ".jpeg", ".png", ".tif", ".tiff", ".heic")


class DatasetError(Exception):
    """Raised with a readable list of problems when the dataset cannot be used."""

    def __init__(self, problems: list[str]):
        self.problems = problems
        head = "\n  - ".join(problems[:25])
        more = f"\n  ... and {len(problems) - 25} more" if len(problems) > 25 else ""
        super().__init__(f"Dataset validation failed ({len(problems)} problem(s)):\n  - {head}{more}")


@dataclass
class Record:
    test_id: str
    sample_id: str
    dir: Path
    meta: dict
    images: dict[str, Path]
    regions: dict
    labels: dict
    adj_count: int
    fabric_type: str
    files_hash: str = ""
    features: dict = field(default_factory=dict)


def unzip(zip_path: Path, dest: Path) -> Path:
    dest.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as z:
        for n in z.namelist():
            target = (dest / n).resolve()
            if not str(target).startswith(str(dest.resolve())):
                raise DatasetError([f"unsafe path in zip: {n}"])
        z.extractall(dest)
    root = dest / "dataset"
    if not root.exists():
        raise DatasetError(["zip has no top-level dataset/ folder"])
    return root


def _find_image(d: Path, stem: str) -> Path | None:
    for ext in IMAGE_EXT:
        p = d / f"{stem}{ext}"
        if p.exists():
            return p
    return None


def load_and_validate(root: Path) -> tuple[list[Record], bool]:
    problems: list[str] = []
    meta_path = root / "metadata.csv"
    if not meta_path.exists():
        raise DatasetError(["metadata.csv is missing"])
    with open(meta_path, newline="", encoding="utf-8") as f:
        meta_rows = list(csv.DictReader(f))
    if not meta_rows:
        raise DatasetError(["metadata.csv has no records"])
    synthetic = (root / "SYNTHETIC.txt").exists() or all(r.get("engine_version") == "synthetic" for r in meta_rows)
    records: list[Record] = []
    seen: set[str] = set()
    for row in meta_rows:
        tid, sid = row.get("test_id", ""), row.get("sample_id", "")
        if not tid or not sid:
            problems.append(f"metadata row without test_id/sample_id: {row}")
            continue
        if tid in seen:
            problems.append(f"{tid}: duplicate test_id in metadata.csv")
        seen.add(tid)
        d = root / "records" / f"{sid}__{tid}"
        if not d.exists():
            problems.append(f"{tid}: record folder {d.name} is missing")
            continue
        adj_count = 2 if (row.get("adj2_fibre") or "").strip() else 1
        need = ["specimen_before", "specimen_after", "adj1_before", "adj1_after"] + (
            ["adj2_before", "adj2_after"] if adj_count == 2 else []
        )
        images = {}
        for stem in need:
            p = _find_image(d, stem)
            if p is None:
                problems.append(f"{tid}: image {stem}.* is missing")
            else:
                images[stem] = p
        regions, labels = {}, {}
        for name in ("regions.json", "labels.json"):
            p = d / name
            if not p.exists():
                problems.append(f"{tid}: {name} is missing")
                continue
            try:
                (regions if name == "regions.json" else labels).update(json.loads(p.read_text(encoding="utf-8")))
            except json.JSONDecodeError as e:
                problems.append(f"{tid}: {name} is not valid JSON ({e})")
        for kind, lab in (labels.get("grades") or {}).items():
            for key in ("assessor_A", "assessor_B", "assessor_C", "consensus"):
                v = lab.get(key)
                if v is not None and float(v) not in GRADES:
                    problems.append(f"{tid}: {kind} {key} = {v} is not one of the 9 grades {GRADES}")
        if not (labels.get("grades") or {}):
            problems.append(f"{tid}: labels.json has no graded kinds")
        for piece in ("SPECIMEN", "ADJ1") + (("ADJ2",) if adj_count == 2 else ()):
            for side in ("before", "after"):
                if _polygon(regions, piece, side) is None:
                    problems.append(f"{tid}: no {piece} {side} region in regions.json")
        h = hashlib.sha256()
        for p in sorted(images.values()):
            h.update(p.read_bytes())
        h.update(json.dumps(regions, sort_keys=True).encode())
        records.append(
            Record(tid, sid, d, row, images, regions, labels, adj_count, row.get("fabric_type") or "PLAIN", h.hexdigest())
        )
    if problems:
        raise DatasetError(problems)
    return records, synthetic


def _polygon(regions: dict, piece: str, side: str):
    for img in regions.get("images", []):
        if (img.get("side") or "") != side:
            continue
        for r in img.get("regions", []):
            if r.get("piece") == piece:
                return r.get("polygon")
    return None


def _grade_record(args) -> dict:
    """Runs in a worker process: grade one record with the engine, return features per kind."""
    rec_dict, work = args
    from silkgrade_engine import grade_test

    pairs = {}
    for key, piece in (("specimen", "SPECIMEN"), ("adj1", "ADJ1"), ("adj2", "ADJ2")):
        if key == "adj2" and rec_dict["adj_count"] < 2:
            continue
        pairs[key] = {
            s: {"path": rec_dict["images"][f"{key}_{s}"], "polygon": _polygon(rec_dict["regions"], piece, s)}
            for s in ("before", "after")
        }
    fibres = [rec_dict["meta"].get("adj1_fibre") or "silk"] + (
        [rec_dict["meta"].get("adj2_fibre") or "cotton"] if rec_dict["adj_count"] > 1 else []
    )
    req = {
        "test_id": rec_dict["test_id"],
        "fabric_type": rec_dict["fabric_type"],
        "adj_count": rec_dict["adj_count"],
        "adj_fibres": fibres,
        "required": {},
        "pairs": pairs,
        "ref_card": None,
        "options": {},
    }
    res = grade_test(req, Path(work) / "derived" / rec_dict["test_id"])
    out = {}
    for g in res["grades"]:
        if g["kind"] == "CHANGE_MOTIF":
            continue
        fibre = (
            fibres[0]
            if g["kind"] == "STAIN_ADJ1"
            else fibres[-1]
            if g["kind"] == "STAIN_ADJ2"
            else (fibres[-1] if g["kind"] == "STAIN_WORST" else "silk")
        )
        ctx = {"fibre": fibre, "fabric_type": rec_dict["fabric_type"], "warnings": g["features"].get("warnings", [])}
        out[g["kind"]] = {
            "iso_rating": g["iso_rating"],
            "flat": flatten_features(g["features"], g["iso_rating"], ctx),
            "decision": g["decision"],
        }
    return {"test_id": rec_dict["test_id"], "engine_version": res["engine_version"], "kinds": out}


def build_features(records: list[Record], work: Path, cache_dir: Path, workers: int | None = None, log=print) -> list[dict]:
    """Feature table: one row per (record, labelled grade kind)."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    todo, results = [], {}
    for r in records:
        cp = cache_dir / f"{r.files_hash}_{ENGINE_VERSION}.json"
        if cp.exists():
            results[r.test_id] = json.loads(cp.read_text(encoding="utf-8"))
        else:
            todo.append(r)
    if todo:
        log(f"  grading {len(todo)} record(s) with engine {ENGINE_VERSION} ({len(records) - len(todo)} cached)…")
        args = [
            (
                {
                    "test_id": r.test_id,
                    "images": {k: str(v) for k, v in r.images.items()},
                    "regions": r.regions,
                    "meta": r.meta,
                    "adj_count": r.adj_count,
                    "fabric_type": r.fabric_type,
                },
                str(work),
            )
            for r in todo
        ]
        n = workers or max(1, min(4, (os.cpu_count() or 2) // 2))
        with ProcessPoolExecutor(max_workers=n) as pool:
            for r, res in zip(todo, pool.map(_grade_record, args, chunksize=2)):
                results[r.test_id] = res
                (cache_dir / f"{r.files_hash}_{ENGINE_VERSION}.json").write_text(json.dumps(res), encoding="utf-8")
    rows = []
    for r in records:
        res = results[r.test_id]
        for kind, lab in (r.labels.get("grades") or {}).items():
            if kind not in res["kinds"] or lab.get("consensus") is None:
                continue
            k = res["kinds"][kind]
            target = "m1_change" if kind.startswith("CHANGE") else "m2_stain"
            rows.append(
                {
                    "test_id": r.test_id,
                    "sample_id": r.sample_id,
                    "kind": kind,
                    "target": target,
                    "label": float(lab["consensus"]),
                    "assessor_A": lab.get("assessor_A"),
                    "assessor_B": lab.get("assessor_B"),
                    "assessor_C": lab.get("assessor_C"),
                    "fabric_type": r.fabric_type,
                    "base_shade": r.meta.get("base_shade") or "unknown",
                    "construction": r.meta.get("construction") or "unknown",
                    "device": r.meta.get("device_before") or "unknown",
                    "engine_version": res["engine_version"],
                    "engine_decision": k["decision"],
                    **{f: float(k["flat"].get(f, 0.0)) for f in FEATURE_NAMES},
                }
            )
    return rows


def save_parquet(rows: list[dict], path: Path) -> None:
    import pyarrow as pa
    import pyarrow.parquet as pq

    pq.write_table(pa.Table.from_pylist(rows), path)


def dataset_hash(records: list[Record]) -> str:
    h = hashlib.sha256()
    for r in sorted(records, key=lambda r: r.test_id):
        h.update(r.test_id.encode())
        h.update(r.files_hash.encode())
        h.update(json.dumps(r.labels, sort_keys=True).encode())
    return h.hexdigest()
