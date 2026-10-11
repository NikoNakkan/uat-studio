"""The baseline run: what the screen comparison compares with, chosen per project or the latest with screenshots."""
import json

import pytest

from app import baseline


def make_run(kit_dir, run_id, screens=True):
    run = kit_dir / "runs" / run_id
    (run / "evidence" / "screenshots").mkdir(parents=True)
    (run / "progress.json").write_text(json.dumps({"stages": {}, "tests": {}}), encoding="utf-8")
    if screens:
        (run / "evidence" / "screenshots" / "TC-01-step1.png").write_bytes(b"png")


@pytest.fixture
def runs(client, kit_dir):
    make_run(kit_dir, "2026-02-01-0000")
    make_run(kit_dir, "2026-02-02-0000")
    make_run(kit_dir, "2026-02-03-0000", screens=False)       # did not get as far as the tests
    yield
    client.put("/api/projects/main/baseline", json={"run_id": None})
    for rid in ("2026-02-01-0000", "2026-02-02-0000", "2026-02-03-0000"):
        client.delete(f"/api/runs/{rid}")


def flags(client):
    return {r["id"]: r["baseline"] for r in client.get("/api/runs").json() if r["id"].startswith("2026-02")}


def test_by_default_the_latest_run_with_screenshots(client, runs):
    assert flags(client) == {"2026-02-01-0000": None, "2026-02-02-0000": "latest", "2026-02-03-0000": None}
    assert baseline.for_run("2026-02-03-0000") == "2026-02-02-0000"
    assert baseline.for_run("2026-02-02-0000") == "2026-02-01-0000"            # never its own baseline


def test_a_chosen_run_is_used_until_reset(client, runs):
    r = client.put("/api/projects/main/baseline", json={"run_id": "2026-02-01-0000"})
    assert r.json() == {"baseline_run": "2026-02-01-0000"}
    assert flags(client)["2026-02-01-0000"] == "chosen"
    assert baseline.for_run("2026-02-03-0000") == "2026-02-01-0000"
    assert baseline.for_run("2026-02-01-0000") is None                          # nothing older with screenshots
    client.put("/api/projects/main/baseline", json={"run_id": None})
    assert flags(client)["2026-02-02-0000"] == "latest"


def test_only_a_run_of_the_project_can_be_chosen(client, runs):
    assert client.put("/api/projects/main/baseline", json={"run_id": "1999-01-01-0000"}).status_code == 400
    assert client.put("/api/projects/nope/baseline", json={"run_id": None}).status_code == 404
