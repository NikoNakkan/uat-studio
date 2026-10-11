"""writing-playwright-plan (excel_to_plan.py) and detecting-test-changes (diff_cases.py)."""
import json

from conftest import GOOD_TEST, case

PLAN = ".github/skills/writing-playwright-plan/scripts/excel_to_plan.py"
DIFF = ".github/skills/detecting-test-changes/scripts/diff_cases.py"


def test_plan_lists_every_case_once_with_login_and_seed(kit):
    kit.excel("runs/cases.xlsx", [case("TC-01"), case("TC-02", title="Approve", group="Approvals",
                                                       login_as="Manager test account")])
    run = kit.intake("runs/cases.xlsx")
    r = kit.run(PLAN, run, expect=0)
    assert "Wrote specs/expenses.plan.md (1 case(s))" in r.out and "Wrote specs/approvals.plan.md" in r.out
    plan = kit.read("specs/approvals.plan.md")
    assert "#### 2.1 TC-02 Approve" in plan and "**Login as:** Manager test account" in plan
    todo = {g["test_id"]: g for g in kit.json(f"{run}/generate-list.json")}
    assert set(todo) == {"TC-01", "TC-02"}
    assert todo["TC-01"]["login_line"] == "" and todo["TC-01"]["seed_file"] == "tests/seed.spec.ts"
    assert todo["TC-02"]["login_line"] == "test.use({ loginAs: 'MANAGER_TEST_ACCOUNT' });"
    assert todo["TC-02"]["seed_file"] == "tests/seeds/manager-test-account.seed.spec.ts"
    seed = kit.read("tests/seeds/manager-test-account.seed.spec.ts")
    assert "test.use({ loginAs: 'MANAGER_TEST_ACCOUNT' });" in seed and "PASSWORD" not in seed
    assert "never type a user name or password" in todo["TC-02"]["body"]
    assert todo["TC-02"]["test_file"] == "tests/approvals/TC-02-approve.spec.ts"


def test_plan_skips_manual_cases(kit):
    kit.excel("runs/cases.xlsx", [case("TC-01"), case("TC-02", title="Email arrives", automation="manual")])
    run = kit.intake("runs/cases.xlsx")
    r = kit.run(PLAN, run, expect=0)
    assert "Not generated: TC-02 (manual" in r.out
    assert [g["test_id"] for g in kit.json(f"{run}/generate-list.json")] == ["TC-01"]
    assert "TC-02" not in kit.read("specs/expenses.plan.md")


def test_plan_keeps_existing_test_file_when_title_changes(kit):
    kit.write("tests/expenses/TC-01-old-title.spec.ts", GOOD_TEST)
    kit.excel("runs/cases.xlsx", [case("TC-01", title="Brand new title")])
    run = kit.intake("runs/cases.xlsx")
    kit.run(PLAN, run, expect=0)
    assert kit.json(f"{run}/generate-list.json")[0]["test_file"] == "tests/expenses/TC-01-old-title.spec.ts"


def test_first_run_has_nothing_to_compare_with(kit):
    run = kit.intake("examples/expense-tracker-tests.xlsx")
    r = kit.run(DIFF, run, expect=0)
    assert "Compared with nothing (first run)" in r.out
    changes = kit.json(f"{run}/changes.json")
    assert all(c["status"] == "new" and c["decision"] == "generate" for c in changes["cases"].values())


def test_second_run_finds_changed_new_and_missing(kit):
    first = kit.intake("examples/expense-tracker-tests.xlsx")
    kit.run(DIFF, first, expect=0)
    kit.write("tests/validation/TC-04-description-is-required.spec.ts", GOOD_TEST)
    second = kit.intake("examples/expense-tracker-tests-v2.xlsx")
    r = kit.run(DIFF, second, expect=0)
    assert f"Compared with {first.split('/')[-1]}" in r.out
    cases = kit.json(f"{second}/changes.json")["cases"]
    assert cases["TC-01"]["status"] == "changed" and cases["TC-01"]["wording_only_candidate"] is True
    assert cases["TC-03"]["status"] == "changed" and cases["TC-03"]["wording_only_candidate"] is False
    assert cases["TC-02"]["status"] == "unchanged" and cases["TC-02"]["decision"] == "generate"   # no test file yet
    assert cases["TC-04"]["status"] == "missing" and cases["TC-04"]["has_test"] is True
    assert cases["TC-07"]["status"] == "new" and cases["TC-07"]["similar_to"] == "TC-04"
    assert "To confirm with the person: 4 (TC-01, TC-03, TC-07, TC-04)" in r.out

    # decisions: a wrong one is refused; "remove" sets the test aside
    r = kit.run(DIFF, second, "--decide", "TC-04", "reuse", expect=1)
    assert "not possible for a missing case" in r.out
    r = kit.run(DIFF, second, "--decide", "TC-04", "remove", expect=0)
    assert "tests/_removed/TC-04-description-is-required.spec.ts" in r.out
    assert kit.path("tests/_removed/TC-04-description-is-required.spec.ts").exists()
    assert not kit.path("tests/validation/TC-04-description-is-required.spec.ts").exists()
    kit.run(DIFF, second, "--decide", "TC-07", "regenerate", expect=0)    # older wording: stored as generate
    assert kit.json(f"{second}/changes.json")["cases"]["TC-07"]["confirmed_by_person"] is True
    assert kit.json(f"{second}/changes.json")["cases"]["TC-07"]["decision"] == "generate"


def test_set_aside_tests_do_not_count_as_tests(kit):
    kit.write("tests/_removed/TC-01-add-an-expense.spec.ts", GOOD_TEST)
    run = kit.intake("examples/expense-tracker-tests.xlsx")
    kit.run(DIFF, run, expect=0)
    assert kit.json(f"{run}/changes.json")["cases"]["TC-01"]["has_test"] is False


def test_manual_cases_need_no_decision(kit):
    kit.excel("runs/cases.xlsx", [case("TC-01"), case("TC-02", title="Email arrives", automation="manual")])
    run = kit.intake("runs/cases.xlsx")
    kit.run(DIFF, run, expect=0)
    entry = kit.json(f"{run}/changes.json")["cases"]["TC-02"]
    assert entry["decision"] == "manual" and entry["manual"] is True
    assert "manual (performed by a person)" in kit.read(f"{run}/changes.md")
    r = kit.run(DIFF, run, "--decide", "TC-02", "regenerate", expect=1)
    assert "manual case" in r.out


def test_runs_current_is_never_the_previous_run(kit):
    kit.write("runs/current/cases.json", json.dumps([]))
    run = kit.intake("examples/expense-tracker-tests.xlsx")
    r = kit.run(DIFF, run, expect=0)
    assert "first run" in r.out


def test_an_existing_test_is_never_rewritten_without_asking(kit):
    """A new case whose test already exists (an earlier run that was not signed off) waits for the person."""
    kit.excel("runs/first.xlsx", [case("TC-01")])
    first = kit.intake("runs/first.xlsx")
    kit.run(DIFF, first, expect=0)
    kit.write_json(f"{first}/signoff.json", {"decisions": {}, "complete": True})
    kit.write("tests/validation/TC-02-a-different-case.spec.ts", GOOD_TEST)
    kit.excel("runs/second.xlsx", [case("TC-01"), case("TC-02", title="Archive an old receipt",
                                                       steps="1. Click \"Archive\"", expected="1. The list shows \"Archived\"")])
    second = kit.intake("runs/second.xlsx")
    kit.run(DIFF, second, expect=0)
    entry = kit.json(f"{second}/changes.json")["cases"]["TC-02"]
    assert entry["status"] == "new" and entry["has_test"] is True and entry["decision"] is None
    assert "a test already exists" in kit.read(f"{second}/changes.md")
