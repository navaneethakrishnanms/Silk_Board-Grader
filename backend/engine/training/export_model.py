"""Package a trained model for upload in Settings -> Model versions.

    python -m training.export_model --model training/out/m1_change.json \
        --metrics training/out/m1_change_metrics.json --out training/out/m1_change_package.json

The package is the model JSON with ``metrics`` and ``sha256`` (of the model
coefficients) embedded; upload it via the admin UI (POST /api/v1/models) and
activate it. New grades then carry its version.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from silkgrade_engine.model import LinearJsonModel  # noqa: E402


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--metrics", default=None)
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)

    spec = json.loads(Path(a.model).read_text(encoding="utf-8"))
    LinearJsonModel(spec)  # validates the structure
    core = {k: spec[k] for k in ("name", "version", "features", "coef", "intercept")}
    spec["sha256"] = hashlib.sha256(json.dumps(core, sort_keys=True).encode()).hexdigest()
    spec["metrics"] = json.loads(Path(a.metrics).read_text(encoding="utf-8")) if a.metrics else {}
    Path(a.out).write_text(json.dumps(spec, indent=2), encoding="utf-8")
    print(f"wrote {a.out}  name={spec['name']} version={spec['version']} sha256={spec['sha256'][:12]}…")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
