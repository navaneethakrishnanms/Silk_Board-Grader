"""Contract tests for engine-svc (/health, /inspect, /detect-regions, /grade)."""

import shutil

import pytest

fastapi = pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture(scope="module")
def client(synthetic_root, tmp_path_factory):
    from engine_svc import settings

    storage = tmp_path_factory.mktemp("storage")
    shutil.copytree(synthetic_root / "plain_shift_3_4", storage / "plain_shift_3_4")
    old, old_tok = settings.STORAGE_ROOT, settings.INTERNAL_TOKEN
    settings.STORAGE_ROOT = storage.resolve()
    settings.INTERNAL_TOKEN = ""
    from engine_svc.main import app

    yield TestClient(app)
    settings.STORAGE_ROOT, settings.INTERNAL_TOKEN = old, old_tok


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["engine_version"] and "m1_change" in body["model_versions"]


def test_inspect(client):
    r = client.post("/inspect", json={"path": "plain_shift_3_4/specimen_before.png"})
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["width"] == 2400 and b["height"] == 1700
    assert set(b["warnings"]) >= {"blur", "clipping", "glare", "lowRes", "noRefCard"}
    assert b["preview_path"].startswith("derived/previews/") and len(b["sha256"]) == 64


def test_inspect_rejects_path_traversal(client):
    r = client.post("/inspect", json={"path": "../../etc/passwd"})
    assert r.status_code in (400, 404)


def test_detect_regions(client):
    r = client.post("/detect-regions", json={"path": "plain_shift_3_4/specimen_before.png",
                                              "expected_pieces": ["SPECIMEN"]})
    assert r.status_code == 200
    regs = r.json()["regions"]
    assert regs and regs[0]["piece_guess"] == "SPECIMEN" and len(regs[0]["polygon"]) >= 4


def test_grade_contract(client, manifest):
    req = manifest["plain_shift_3_4"]["request"]
    r = client.post("/grade", json=req)
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["model_version"] == "formula-only"
    assert b["registration"]["ok"] is True
    kinds = [g["kind"] for g in b["grades"]]
    assert kinds == ["CHANGE_OVERALL", "STAIN_ADJ1", "STAIN_ADJ2", "STAIN_WORST"]
    for g in b["grades"]:
        assert g["heatmap_path"].startswith("derived/plain_shift_3_4/")


def test_grade_validation_error(client):
    r = client.post("/grade", json={"test_id": "x", "fabric_type": "WOVEN", "pairs": {}})
    assert r.status_code == 422


def test_register(client, manifest):
    pair = manifest["plain_shift_3_4"]["request"]["pairs"]["specimen"]
    r = client.post("/register", json={"before": pair["before"], "after": pair["after"]})
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True and r.json()["inliers"] > 25


def test_token_enforced_when_configured(client):
    from engine_svc import settings

    settings.INTERNAL_TOKEN = "secret-token"
    try:
        assert client.post("/inspect", json={"path": "x.png"}).status_code == 401
        ok = client.post("/inspect", json={"path": "plain_shift_3_4/specimen_before.png"},
                         headers={"x-engine-token": "secret-token"})
        assert ok.status_code == 200
    finally:
        settings.INTERNAL_TOKEN = ""
