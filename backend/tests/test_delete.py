"""A run can always be stopped and deleted; a signed-off run only with an explicit confirmation."""
from app import kit


def new_run(client, kit_dir) -> str:
    with (kit_dir / "examples" / "expense-tracker-tests.xlsx").open("rb") as f:
        r = client.post("/api/runs", files={"file": ("expense-tracker-tests.xlsx", f)},
                        data={"strictness": "standard", "start": "false"})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_delete_removes_the_run_and_its_evidence(client, kit_dir):
    run_id = new_run(client, kit_dir)
    assert (kit.runs_dir() / run_id).exists()
    assert client.delete(f"/api/runs/{run_id}").json() == {"deleted": run_id}
    assert not (kit.runs_dir() / run_id).exists()
    assert all(r["id"] != run_id for r in client.get("/api/runs").json())
    assert client.delete(f"/api/runs/{run_id}").status_code == 404


def test_signed_off_run_needs_explicit_confirmation(client, kit_dir):
    run_id = new_run(client, kit_dir)
    (kit.runs_dir() / run_id / "manifest.json").write_text("{}", encoding="utf-8")
    r = client.delete(f"/api/runs/{run_id}")
    assert r.status_code == 409 and "signed off" in r.json()["detail"]
    assert client.delete(f"/api/runs/{run_id}?signed_off=true").status_code == 200


def test_only_run_folders_can_be_deleted(client):
    for bad in ["current", "..", "setup%2F..%2F..", "no-such-run"]:
        assert client.delete(f"/api/runs/{bad}").status_code in (400, 404, 405)


def test_login_setup_can_always_be_stopped(client):
    assert client.post("/api/setup/login/stop").json() == {"running": False}
