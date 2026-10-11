"""scripts/run_tests.py: what it refuses before Playwright is even started (no browser is needed here)."""
from conftest import GOOD_TEST, case


def test_needs_an_intake(kit):
    run = kit.new_run()
    r = kit.run("scripts/run_tests.py", run, expect=2)
    assert "No cases.json" in r.out


def test_refuses_set_aside_tests(kit):
    run = kit.intake("examples/expense-tracker-tests.xlsx")
    kit.write("tests/_removed/TC-01-add-an-expense.spec.ts", GOOD_TEST)
    r = kit.run("scripts/run_tests.py", run, "tests/_removed/TC-01-add-an-expense.spec.ts", expect=2)
    assert "set aside in tests/_removed/" in r.out


def test_manual_cases_and_cases_without_a_test_are_listed(kit):
    kit.excel("runs/cases.xlsx", [case("TC-01"), case("TC-02", title="Email arrives", automation="manual")])
    run = kit.intake("runs/cases.xlsx")
    r = kit.run("scripts/run_tests.py", run, expect=2)
    assert "MANUAL   TC-02 (a person performs it" in r.out
    assert "NO TEST  TC-01 (no test file yet)" in r.out
    assert "Nothing to run." in r.out


def test_resume_with_everything_done(kit):
    kit.excel("runs/cases.xlsx", [case("TC-01")])
    run = kit.intake("runs/cases.xlsx")
    kit.write("tests/expenses/TC-01-add-an-expense.spec.ts", GOOD_TEST)
    progress = kit.json(f"{run}/progress.json")
    progress["tests"] = {"TC-01": {"result": "passed", "evidence": "evidence"}}
    kit.write_json(f"{run}/progress.json", progress)
    r = kit.run("scripts/run_tests.py", run, "--resume", expect=0)
    assert "Nothing left to run" in r.out
