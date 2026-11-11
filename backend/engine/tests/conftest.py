from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

import pytest

ENGINE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENGINE_DIR))

CACHE = ENGINE_DIR / ".pytest_synthetic"


@pytest.fixture(scope="session")
def synthetic_root() -> Path:
    """Synthetic cases generated once and cached between test runs."""
    from tools.make_synthetic import build_cases

    if not (CACHE / "manifest.json").exists():
        build_cases(CACHE, "all")
    return CACHE


@pytest.fixture(scope="session")
def manifest(synthetic_root) -> dict:
    data = json.loads((synthetic_root / "manifest.json").read_text(encoding="utf-8"))
    return {c["name"]: c for c in data["cases"]}


def absolute_request(case: dict, root: Path) -> dict:
    req = copy.deepcopy(case["request"])
    for pair in req["pairs"].values():
        for side in ("before", "after"):
            pair[side]["path"] = str(root / pair[side]["path"])
    return req


@pytest.fixture(scope="session")
def graded(manifest, synthetic_root, tmp_path_factory):
    """Grade every synthetic case once per session (formula-only mode)."""
    from silkgrade_engine import grade_test

    out = tmp_path_factory.mktemp("graded")
    return {name: grade_test(absolute_request(c, synthetic_root), out / name) for name, c in manifest.items()}


def by_kind(result: dict, kind: str) -> list[dict]:
    return [g for g in result["grades"] if g["kind"] == kind]
