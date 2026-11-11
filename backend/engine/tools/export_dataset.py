"""Convert ``dataset.zip`` (from GET /api/v1/export/dataset.zip, Section 10.2)
into a flat features table for training.

    python tools/export_dataset.py --zip dataset.zip --out dataset_features.csv

One row per (test, grade kind) with the engine features and the consensus
expert label. Rows without a consensus label are skipped.
"""

from __future__ import annotations

import argparse
import json
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from silkgrade_engine.model import flatten_features  # noqa: E402
from training.common import GROUP, TARGET, write_table  # noqa: E402


def rows_from_zip(zpath: str | Path) -> list[dict]:
    rows = []
    with zipfile.ZipFile(zpath) as z:
        names = z.namelist()
        recs = sorted({n.split("/")[2] for n in names if n.startswith("dataset/records/") and n.count("/") >= 3})
        for rec in recs:
            base = f"dataset/records/{rec}/"
            try:
                feats = json.loads(z.read(base + "features.json"))
                labels = json.loads(z.read(base + "labels.json"))
            except KeyError:
                continue
            test_id = rec.split("__")[-1]
            for kind, f in feats.get("grades", {}).items():
                lab = (labels.get("grades", {}).get(kind) or {}).get("consensus")
                if lab is None:
                    continue
                ctx = {"fibre": f.get("fibre"), "fabric_type": feats.get("fabric_type"),
                       "n_warnings": len(f.get("features", {}).get("warnings", []))}
                flat = flatten_features(f.get("features", {}), f.get("iso_rating", 5.0), ctx)
                rows.append({GROUP: test_id, "kind": kind, TARGET: float(lab), **flat})
    return rows


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    rows = rows_from_zip(a.zip)
    write_table(rows, a.out)
    print(f"wrote {len(rows)} labelled rows to {a.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
