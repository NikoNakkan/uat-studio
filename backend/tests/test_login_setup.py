"""Login setup starts from the test cases and Studio's own account status, not from questions or repo files."""
import time

from app import kit, pw_agents
from app.api import login_task

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def test_login_setup_reads_the_test_cases(client, kit_dir):
    excel = kit_dir / "examples" / "expense-tracker-tests.xlsx"
    with excel.open("rb") as f:
        r = client.post("/api/setup/login", files={"file": ("cases.xlsx", f, XLSX)})
    assert r.status_code == 200, r.text
    assert kit.read_json(kit.runs_dir() / "setup" / "cases.json")        # the Excel was read
    source, cases = kit.latest_cases()                                    # a run's cases come first
    assert cases and source
    prompt = pw_agents.login_prompt()
    assert cases[0]["test_id"] in prompt and "Look first" in prompt
    assert ".env.example" not in prompt and "Never ask about files" in prompt
    for _ in range(50):                                   # no API key in tests: the job stops at once
        t = login_task.get("job")
        if t is None or t.done():
            break
        time.sleep(0.1)


def test_accounts_say_filled_or_missing_and_who_uses_them(client):
    client.post("/api/env/accounts", json={"label": "Auditor test account"})
    client.put("/api/env", json={"key": "AUDITOR_TEST_ACCOUNT_USER", "value": "auditor@example.test"})
    acc = {a["name"]: a for a in kit.accounts_overview([{"test_id": "TC-09", "login_as": "Auditor test account"}])}
    assert acc["AUDITOR_TEST_ACCOUNT"]["user_set"] and not acc["AUDITOR_TEST_ACCOUNT"]["password_set"]
    assert acc["AUDITOR_TEST_ACCOUNT"]["label"] == "Auditor test account"
    assert acc["AUDITOR_TEST_ACCOUNT"]["user"] == "auditor@example.test"
    assert acc["AUDITOR_TEST_ACCOUNT"]["used_by"] == ["TC-09"]
    assert "auditor@example.test" not in pw_agents.login_prompt()


def test_a_non_excel_file_is_refused(client):
    r = client.post("/api/setup/login", files={"file": ("cases.csv", b"a,b", "text/csv")})
    assert r.status_code == 400 and ".xlsx" in r.json()["detail"]


def test_the_newer_excel_wins_and_is_named(client, kit_dir):
    """An Excel given at login setup after a run must be the one the agent reads, shown by its own name."""
    import os
    import time
    with (kit_dir / "examples" / "expense-tracker-tests.xlsx").open("rb") as f:
        run_id = client.post("/api/runs", files={"file": ("old-run.xlsx", f)},
                             data={"strictness": "standard", "start": "false"}).json()["id"]
    cases = kit.runs_dir() / run_id / "cases.json"
    cases.write_text('[{"test_id": "TC-01", "login_as": "Run account"}]', encoding="utf-8")
    os.utime(cases, (time.time() - 60, time.time() - 60))
    with (kit_dir / "examples" / "expense-tracker-tests.xlsx").open("rb") as f:
        assert client.post("/api/setup/login", files={"file": ("my-cases.xlsx", f, XLSX)}).status_code == 200
    src = client.get("/api/setup/login-source").json()
    assert src["source"] == "login setup" and src["excel"] == "my-cases.xlsx" and src["cases"] > 0
    client.post("/api/setup/login/stop")
    client.delete(f"/api/runs/{run_id}")
