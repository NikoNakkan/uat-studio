"""The loops of the flow, with how many times a run went round each (the stepper draws them)."""
import json

from app import kit, loops


def test_counts_come_from_the_run_state_and_old_runs_still_count():
    ids = [s["id"] for s in kit.workflow()["stages"]]
    state = {"planner_rounds": 1, "generate_attempts": {"TC-35": 2}}
    got = {(loop["from"], loop["to"]): loop["count"] for loop in loops.of_run(state, ids)}
    assert got == {("planner_check", "clarify"): 1, ("test_check", "generate"): 2}
    assert loops.of_run({}, ["clarify", "generate"]) == []                 # a stage switched off: no loop to draw


def test_the_run_detail_carries_the_loops(client, kit_dir):
    run = kit_dir / "runs" / "2026-01-08-0000"
    run.mkdir(parents=True)
    (run / "progress.json").write_text(json.dumps({"stages": {}, "tests": {}}), encoding="utf-8")
    (run / "studio-state.json").write_text(json.dumps({"test_check_rounds": 1}), encoding="utf-8")
    got = client.get("/api/runs/2026-01-08-0000").json()["loops"]
    assert {k: got[1][k] for k in ("from", "to", "count")} == {"from": "test_check", "to": "generate", "count": 1}
