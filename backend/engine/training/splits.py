"""Split by SAMPLE (never by image or test), stratified by grade, 70/15/15 (WP6 step 3),
persisted next to the runs so every run uses the same split, plus the one-time test-set lock (step 9)."""

from __future__ import annotations

import hashlib
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

FRACTIONS = (0.70, 0.15, 0.15)


class SplitError(Exception):
    pass


def make_split(rows: list[dict], seed: int) -> dict[str, str]:
    """sample_id -> train | val | test. Stratum = most common consensus grade of the sample (M1 first)."""
    by_sample: dict[str, list[float]] = defaultdict(list)
    for r in sorted(rows, key=lambda r: (r["target"] != "m1_change", r["test_id"])):
        by_sample[r["sample_id"]].append(r["label"])
    strata: dict[float, list[str]] = defaultdict(list)
    for s, labels in by_sample.items():
        strata[Counter(labels).most_common(1)[0][0]].append(s)
    rng = np.random.default_rng(seed)
    assign: dict[str, str] = {}
    carry = np.zeros(3)  # keeps small strata from all landing in "train"
    for grade in sorted(strata):
        samples = sorted(strata[grade])
        rng.shuffle(samples)
        for s in samples:
            want = np.array(FRACTIONS) * (sum(carry) + 1) - carry
            k = int(np.argmax(want))
            carry[k] += 1
            assign[s] = ("train", "val", "test")[k]
    return assign


def split_hash(assign: dict[str, str]) -> str:
    return hashlib.sha256(json.dumps(sorted(assign.items())).encode()).hexdigest()[:16]


def load_or_create(runs_root: Path, rows: list[dict], data_hash: str, new_split: bool, seed: int) -> dict:
    path = runs_root / "split.json"
    if path.exists() and not new_split:
        saved = json.loads(path.read_text(encoding="utf-8"))
        samples = {r["sample_id"] for r in rows}
        if saved.get("dataset_hash") == data_hash and samples <= set(saved["assign"]):
            return saved
    if path.exists() and not new_split:
        seed = json.loads(path.read_text(encoding="utf-8")).get("seed", seed)
    elif new_split and path.exists():
        seed = int(json.loads(path.read_text(encoding="utf-8")).get("seed", seed)) + 1
    assign = make_split(rows, seed)
    saved = {
        "dataset_hash": data_hash,
        "seed": seed,
        "assign": assign,
        "hash": split_hash(assign),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    runs_root.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(saved, indent=2), encoding="utf-8")
    return saved


def validate(rows: list[dict], assign: dict[str, str]) -> None:
    """A sample (and therefore every image of it) must be in exactly one split."""
    seen: dict[str, str] = {}
    problems = []
    for r in rows:
        sp = assign.get(r["sample_id"])
        if sp is None:
            problems.append(f"sample {r['sample_id']} has no split")
            continue
        prev = seen.setdefault(r["sample_id"], sp)
        if prev != sp:
            problems.append(f"sample {r['sample_id']} appears in both {prev} and {sp}")
    if problems:
        raise SplitError("Split validation failed:\n  - " + "\n  - ".join(problems[:20]))


def check_final_lock(runs_root: Path, split: dict, new_split: bool) -> None:
    lock = runs_root / "final_lock.json"
    data = json.loads(lock.read_text(encoding="utf-8")) if lock.exists() else {}
    if split["hash"] in data and not new_split:
        prev = data[split["hash"]]
        raise SplitError(
            f"The test set of split {split['hash']} was already evaluated with --final on {prev['at']} "
            f"(run {prev['run']}). Re-using a test set biases the result. Use --new-split to draw a fresh split."
        )


def record_final(runs_root: Path, split: dict, run_dir: Path) -> None:
    lock = runs_root / "final_lock.json"
    data = json.loads(lock.read_text(encoding="utf-8")) if lock.exists() else {}
    data[split["hash"]] = {"run": str(run_dir), "at": datetime.now(timezone.utc).isoformat()}
    lock.write_text(json.dumps(data, indent=2), encoding="utf-8")
