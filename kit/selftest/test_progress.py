"""scripts/progress.py: run folders, stages, the latest run, the scratch folder runs/current."""
import json


def test_new_run_records_what_it_was_made_from(kit):
    run = kit.new_run()
    progress = kit.json(f"{run}/progress.json")
    assert progress["run_id"] == run.split("/")[-1]
    assert len(progress["excel_sha256"]) == 64 and progress["excel"] == "expense-tracker-tests.xlsx"
    assert {"playwright", "node", "kit_git"} <= set(progress["tools"])
    assert kit.path(f"{run}/input.xlsx").exists()


def test_new_run_refuses_missing_excel(kit):
    r = kit.run("scripts/progress.py", "new", "nowhere.xlsx", expect=1)
    assert "not found" in r.out


def test_latest_and_show(kit):
    run = kit.new_run()
    assert kit.run("scripts/progress.py", "latest", expect=0).out.strip() == run
    r = kit.run("scripts/progress.py", "show", run, expect=0)
    assert "Next stage: preflight" in r.out


def test_stage_updates_next_stage(kit):
    run = kit.new_run()
    kit.run("scripts/progress.py", "stage", run, "preflight", "done", expect=0)
    kit.run("scripts/progress.py", "stage", run, "intake", "done", "--note", "6 cases", expect=0)
    r = kit.run("scripts/progress.py", "show", run, expect=0)
    assert "Next stage: clarify" in r.out and "6 cases" in r.out
    r = kit.run("scripts/progress.py", "stage", run, "no-such-stage", "done", expect=1)
    assert "Unknown stage" in r.out


def test_runs_current_is_not_a_run(kit):
    """Playwright's scratch folder has a progress.json without run_id: latest ignores it, show refuses it."""
    run = kit.new_run()
    kit.write("runs/current/progress.json", json.dumps({"tests": {}}))
    assert kit.run("scripts/progress.py", "latest", expect=0).out.strip() == run
    r = kit.run("scripts/progress.py", "show", "runs/current", expect=1)
    assert "not a run folder" in r.out


def test_latest_without_runs(kit):
    r = kit.run("scripts/progress.py", "latest", expect=1)
    assert "No runs yet" in r.out
