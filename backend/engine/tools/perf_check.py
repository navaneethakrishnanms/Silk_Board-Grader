"""Performance check (Section 11): grading a 12 MP before/after pair must take < 5 s.

Usage:  python tools/perf_check.py [--runs 3] [--keep DIR]
Creates a 4000x3000 (12 MP) JPEG specimen pair + one adjacent pair and times
``grade_test``. Exit code 1 if the median time exceeds the budget.
"""

from __future__ import annotations

import argparse
import statistics
import sys
import tempfile
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from silkgrade_engine import grade_test  # noqa: E402
from tools.make_synthetic import (WHITE_SILK, compose, fabric_rect, plain, polygon_of,  # noqa: E402
                                  sensor_noise, texture)

BUDGET_S = 5.0


def make_pair(d: Path, w=4000, h=3000):
    import cv2

    rect = fabric_rect(h, w)
    poly = polygon_of(rect)
    tex = texture(h, w, 11)
    files = {}
    for name, lab in (("specimen_before", (50, 35, 15)), ("specimen_after", (53.4, 35, 15)),
                      ("adj1_before", WHITE_SILK), ("adj1_after", (WHITE_SILK[0] - 3, 0.5, 3.0))):
        rgb = compose(plain(lab, h, w), rect, h, w, tex, sensor_noise(h, w, hash(name) % 1000))
        p = d / f"{name}.jpg"
        cv2.imwrite(str(p), (np.clip(rgb, 0, 1) * 255).astype(np.uint8)[:, :, ::-1], [cv2.IMWRITE_JPEG_QUALITY, 95])
        files[name] = str(p)
    return {
        "test_id": "perf", "fabric_type": "PLAIN", "adj_count": 1, "adj_fibres": ["silk"],
        "required": {"change": 4.0, "stain": 3.5},
        "pairs": {"specimen": {"before": {"path": files["specimen_before"], "polygon": poly},
                               "after": {"path": files["specimen_after"], "polygon": poly}},
                  "adj1": {"before": {"path": files["adj1_before"], "polygon": poly},
                           "after": {"path": files["adj1_after"], "polygon": poly}}},
        "options": {},
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--keep", default=None)
    a = ap.parse_args()
    d = Path(a.keep) if a.keep else Path(tempfile.mkdtemp(prefix="sg_perf_"))
    d.mkdir(parents=True, exist_ok=True)
    print(f"generating 12 MP images in {d} ...")
    req = make_pair(d)
    grade_test(req, d / "out")  # warm-up (imports, JIT caches)
    times = []
    for i in range(a.runs):
        t = time.perf_counter()
        r = grade_test(req, d / "out")
        times.append(time.perf_counter() - t)
        print(f"run {i + 1}: {times[-1]:.2f} s  stages={r['timings_ms']}")
    med = statistics.median(times)
    ok = med < BUDGET_S
    print(f"median {med:.2f} s for specimen pair + 1 adjacent pair (12 MP each) -> {'PASS' if ok else 'FAIL'} (< {BUDGET_S} s)")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
