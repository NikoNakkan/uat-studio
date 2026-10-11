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


def test_a_retried_test_stage_runs_every_test_again(kit_dir):
    """Resume skips tests that already have a result; a retry of the test stage must not (the app may have changed)."""
    import asyncio
    import json

    from app import kit
    from app.engine import engine
    from app.stage_base import Ctx

    run = kit_dir / "runs" / "2026-01-02-0000"
    run.mkdir(parents=True)
    (run / "progress.json").write_text(json.dumps({"stages": {}, "tests": {"TC-01": {"result": "passed"}}}), encoding="utf-8")
    seen: list[tuple] = []

    class Done:
        code, output = 0, ""

    async def fake_script(c, name, *args, **kw):
        seen.append(args)
        return Done()

    engine.script = fake_script
    try:
        c = Ctx("2026-01-02-0000")
        asyncio.run(engine.stage_run(c))
        c.mark_retried("run")
        asyncio.run(engine.stage_run(c))
        asyncio.run(engine.stage_run(c))
    finally:
        del engine.script
    assert ["--resume" in a for a in seen] == [True, False, True]   # resume, retry (all tests), resume again
    assert "retried" not in kit.read_json(run / "studio-state.json", {})


def test_retrying_a_stage_redoes_the_stages_after_it(client, kit_dir):
    import json

    from app import kit
    from app.engine import engine

    ids = [s["id"] for s in kit.workflow()["stages"]]
    run_stage = ids.index("run")
    run = kit_dir / "runs" / "2026-01-03-0000"
    run.mkdir(parents=True)
    stages = {s: {"status": "done"} for s in ids[: run_stage + 3]}
    stages[ids[run_stage + 1]] = {"status": "skipped"}
    (run / "progress.json").write_text(json.dumps({"stages": stages, "tests": {}}), encoding="utf-8")
    started = engine.start
    engine.start = lambda run_id: None          # only the marking is under test
    try:
        assert client.post("/api/runs/2026-01-03-0000/retry", json={"stage": "run"}).json() == {"running": True}
    finally:
        engine.start = started
    after = kit.read_json(run / "progress.json")["stages"]
    assert after[ids[run_stage - 1]]["status"] == "done"            # before the retried stage: kept
    assert after["run"]["status"] == "started"
    assert after[ids[run_stage + 1]]["status"] == "skipped"          # switched off: stays off
    assert after[ids[run_stage + 2]]["status"] == "started"          # after it: done again
    assert client.post("/api/runs/2026-01-03-0000/retry", json={"stage": "nope"}).status_code == 400


def test_redo_signoff_clears_the_seal_and_keeps_the_old_signoff(client, kit_dir):
    import json

    from app import kit
    from app.engine import engine

    run = kit_dir / "runs" / "2026-01-04-0000"
    run.mkdir(parents=True)
    stages = {s["id"]: {"status": "done"} for s in kit.workflow()["stages"]}
    (run / "progress.json").write_text(json.dumps({"stages": stages, "tests": {}}), encoding="utf-8")
    decisions = {"decisions": {"Billing": {"decision": "PASS", "by": "nikos"}}, "complete": True}
    (run / "signoff.json").write_text(json.dumps(decisions), encoding="utf-8")
    (run / "manifest.json").write_text("{}", encoding="utf-8")
    (run / "results.xlsx").write_bytes(b"x")
    started = engine.start
    engine.start = lambda run_id: None
    try:
        r = client.post("/api/runs/2026-01-04-0000/signoff/redo").json()
    finally:
        engine.start = started
    assert r["running"] and r["kept_in"].startswith("earlier-signoffs/")
    assert not any((run / f).exists() for f in ("manifest.json", "signoff.json", "results.xlsx"))
    assert json.loads((run / r["kept_in"] / "signoff.json").read_text(encoding="utf-8")) == decisions
    assert kit.read_json(run / "progress.json")["stages"]["signoff"]["status"] == "started"
    assert not next(x for x in client.get("/api/runs").json() if x["id"] == "2026-01-04-0000")["sealed"]


def test_a_stage_studio_no_longer_has_is_skipped(kit_dir, monkeypatch):
    """A project made before the console review was removed still lists it in its own workflow.yaml."""
    import asyncio
    import json

    from app import kit
    from app.engine import engine

    run = kit_dir / "runs" / "2026-01-05-0000"
    run.mkdir(parents=True)
    (run / "progress.json").write_text(json.dumps({"stages": {}, "tests": {}}), encoding="utf-8")
    real = kit.workflow
    monkeypatch.setattr(kit, "workflow", lambda: {**real(), "stages": [{"id": "console_review"}]})
    marks = []

    async def mark(c, sid, status, note=""):
        marks.append((sid, status))

    monkeypatch.setattr(engine, "mark", mark)
    asyncio.run(engine._run_owned("2026-01-05-0000"))
    assert marks == [("console_review", "skipped")]
