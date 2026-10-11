"""A run can always be stopped and deleted; a signed-off run only with an explicit confirmation."""
import os
import subprocess
import sys

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


def _alive(pid: int) -> bool:
    if os.name == "nt":
        out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True)
        return str(pid) in out.stdout
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def test_stop_kills_the_command_and_its_children(tmp_path):
    """Stop has to end the shell and the program under it. Cancelling the task used to leave both running."""
    import contextvars
    import threading
    import time

    pidfile = tmp_path / "child.pid"
    script = tmp_path / "sleeper.py"
    script.write_text(
        "import pathlib, subprocess, sys, time\n"
        "child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])\n"
        f"pathlib.Path({str(pidfile)!r}).write_text(str(child.pid))\n"
        "time.sleep(60)\n",
        encoding="utf-8",
    )
    token = kit.push_script_owner("stop-test")
    done = threading.Event()

    def work():
        try:
            kit._run_blocking([sys.executable, str(script)], 20, None)
        finally:
            done.set()

    thread = threading.Thread(target=contextvars.copy_context().run, args=(work,))
    thread.start()
    try:
        deadline = time.time() + 8
        while time.time() < deadline and not pidfile.exists():
            time.sleep(0.05)
        assert pidfile.exists(), "the command never started"
        child = int(pidfile.read_text())
        assert kit.kill_owned("stop-test") >= 1
        assert done.wait(8), "the command kept running after stop"
        deadline = time.time() + 5
        while time.time() < deadline and _alive(child):
            time.sleep(0.1)
        assert not _alive(child)
    finally:
        kit.kill_owned("stop-test")
        kit.pop_script_owner(token)
        thread.join(3)
