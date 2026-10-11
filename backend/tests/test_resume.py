"""Resume (POST /runs/{id}/start) must start the run on the server's event loop."""


def test_resume_starts_the_run(client, kit_dir):
    with (kit_dir / "examples" / "expense-tracker-tests.xlsx").open("rb") as f:
        run_id = client.post("/api/runs", files={"file": ("expense-tracker-tests.xlsx", f)},
                             data={"strictness": "standard", "start": "false"}).json()["id"]
    r = client.post(f"/api/runs/{run_id}/start")
    assert r.status_code == 200, r.text                       # was 500: "no running event loop"
    assert r.json() == {"running": True}
    client.post(f"/api/runs/{run_id}/stop")
    client.delete(f"/api/runs/{run_id}")
