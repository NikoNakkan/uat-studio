"""checking-generated-tests: check_tests.py accepts a straight-line test with real checks and rejects the rest."""
import pytest

from conftest import APP_MAP, GOOD_TEST, case

CHECK = ".github/skills/checking-generated-tests/scripts/check_tests.py"
TEST_FILE = "tests/expenses/TC-01-add-an-expense.spec.ts"


@pytest.fixture
def run(kit):
    kit.write("app-map/app-map.yaml", APP_MAP)
    kit.excel("runs/cases.xlsx", [case("TC-01")])
    return kit.intake("runs/cases.xlsx")


def check(kit, run, code, *args):
    kit.write(TEST_FILE, code)
    r = kit.run(CHECK, run, *args)
    report = kit.json(f"{run}/test-check.json")["files"].get(TEST_FILE, {})
    return r, report.get("problems", [])


def test_good_test_is_accepted(kit, run):
    r, problems = check(kit, run, GOOD_TEST)
    assert r.returncode == 0 and problems == [], r.out
    assert "1 accepted, 0 rejected" in r.out


@pytest.mark.parametrize("old, new, expected", [
    ("import { test, expect } from '../fixtures';", "import { test, expect } from '@playwright/test';",
     "does not import test from tests/fixtures.ts"),
    ("test('TC-01 Add an expense'", "test('Add an expense'", "the test title must start with the Test ID TC-01"),
    ("await shot(2);", "", "step 2 has no 'await shot(2)'"),
    ("// 2. Type 12.50 in Amount (EUR)", "// amount", "step 2 has no '// 2. ...' comment"),
    ("await expect(status).toContainText('Added Taxi');", "await expect(status).toBeVisible();",
     "expected result '3. The status message shows \"Added Taxi\"': the check does not contain 'Added Taxi'"),
])
def test_missing_pieces_are_named(kit, run, old, new, expected):
    r, problems = check(kit, run, GOOD_TEST.replace(old, new))
    assert r.returncode == 1 and any(expected in p for p in problems), problems


@pytest.mark.parametrize("snippet", [
    "await page.evaluate(() => 1);", "await page.route('**/api/**', r => r.fulfill({ body: '{}' }));",
    "try { await shot(9); } catch (e) {}", "if (await status.isVisible()) { await shot(9); }",
    "await page.waitForTimeout(500);", "test.skip();", "const r = await page.request.get('/api');",
])
def test_forbidden_text_is_rejected(kit, run, snippet):
    code = GOOD_TEST.replace("  await shot(3);", f"  {snippet}\n  await shot(3);")
    r, problems = check(kit, run, code)
    assert r.returncode == 1 and any("forbidden" in p for p in problems), problems


def test_forbidden_words_in_comments_are_ignored(kit, run):
    code = GOOD_TEST.replace("  await shot(3);", "  // do not use page.evaluate( or try { here\n  await shot(3);")
    r, _ = check(kit, run, code)
    assert r.returncode == 0, r.out


def test_checks_that_prove_nothing_do_not_count(kit, run):
    code = GOOD_TEST.replace("await expect(status).toContainText('Added Taxi');", "await expect(true).toBe(true);")
    r, problems = check(kit, run, code)
    assert any("always true: checks a constant" in p for p in problems), problems
    code = GOOD_TEST.replace("await expect(status).toContainText('Added Taxi');",
                             "await expect(page.getByRole('list', { name: 'Expenses' })).toBeVisible();")
    r, problems = check(kit, run, code)
    assert any("only checks that a list exists" in p for p in problems), problems


def test_check_must_target_an_app_map_element(kit, run):
    code = GOOD_TEST.replace("page.getByRole('status')", "page.getByText('Total')")   # both checks, via the variable too
    r, problems = check(kit, run, code)
    assert any("no check on an element recorded in app-map" in p for p in problems), problems


def test_goto_must_stay_on_allowed_sites(kit, run):
    code = GOOD_TEST.replace("await page.goto('http://localhost:4173/');",
                             "await page.goto('http://localhost:4173/');\n  await page.goto('https://evil.example.com/');")
    r, problems = check(kit, run, code)
    assert any("goto('https://evil.example.com/') leaves the allowed sites" in p for p in problems), problems


def test_login_must_match_the_excel(kit):
    kit.write("app-map/app-map.yaml", APP_MAP)
    kit.excel("runs/cases.xlsx", [case("TC-01", login_as="Employee test account")])
    run = kit.intake("runs/cases.xlsx")
    r, problems = check(kit, run, GOOD_TEST)
    assert any("needs test.use({ loginAs: 'EMPLOYEE_TEST_ACCOUNT' })" in p for p in problems), problems
    with_login = GOOD_TEST.replace("import { test, expect } from '../fixtures';",
                                   "import { test, expect } from '../fixtures';\n\ntest.use({ loginAs: 'EMPLOYEE_TEST_ACCOUNT' });")
    r, problems = check(kit, run, with_login)
    assert r.returncode == 0, problems
    wrong = with_login.replace("EMPLOYEE_TEST_ACCOUNT", "MANAGER_TEST_ACCOUNT")
    r, problems = check(kit, run, wrong)
    assert any("not 'MANAGER_TEST_ACCOUNT'" in p for p in problems), problems


def test_a_test_may_not_log_in_by_itself(kit, run):
    code = GOOD_TEST.replace("// 1. Type", "await page.getByLabel('Password').fill(process.env.EMPLOYEE_TEST_ACCOUNT_PASSWORD!);\n  // 1. Type")
    r, problems = check(kit, run, code)
    assert any("a password or a password variable appears in the test" in p for p in problems), problems
    code = GOOD_TEST.replace("// 1. Type", "const password = 'hunter2';\n  // 1. Type")
    r, problems = check(kit, run, code)
    assert any("a password or a password variable appears in the test" in p for p in problems), problems
    code = GOOD_TEST.replace("import { test, expect } from '../fixtures';",
                             "import { test, expect } from '../fixtures';\ntest.use({ loginAs: 'EMPLOYEE_TEST_ACCOUNT' });")
    r, problems = check(kit, run, code)
    assert any("names no account, but the test logs in as 'EMPLOYEE_TEST_ACCOUNT'" in p for p in problems), problems


def test_apostrophes_are_not_quotes(kit):
    kit.write("app-map/app-map.yaml", APP_MAP)
    kit.excel("runs/cases.xlsx", [case("TC-01", expected="3. The status message shows the user's text \"Added Taxi\"")])
    run = kit.intake("runs/cases.xlsx")
    r, problems = check(kit, run, GOOD_TEST)
    assert r.returncode == 0, problems


def test_assertion_lock_catches_changed_and_disguised_checks(kit, run):
    kit.write(TEST_FILE, GOOD_TEST)
    kit.run(CHECK, run, "--snapshot", "TC-01", expect=0)
    assert kit.path(f"{run}/tests-before/TC-01-add-an-expense.spec.ts").exists()

    # a repair that only changes a locator's option is fine
    same_checks = GOOD_TEST.replace("{ name: 'Add expense' }).click()", "{ name: 'Add expense', exact: true }).click()")
    r, problems = check(kit, run, same_checks, "--assertion-lock")
    assert r.returncode == 0, problems

    # changing the text a check looks for
    r, problems = check(kit, run, GOOD_TEST.replace("toContainText('Added Taxi')", "toContainText('Added')"), "--assertion-lock")
    assert any(p.startswith("assertion lock") for p in problems), problems

    # keeping the expect line, but redefining the variable it checks
    r, problems = check(kit, run, GOOD_TEST.replace("const status = page.getByRole('status');",
                                                   "const status = page.getByRole('main');"), "--assertion-lock")
    assert any(p.startswith("assertion lock") for p in problems), problems

    # removing a check
    r, problems = check(kit, run, GOOD_TEST.replace("  await expect(page.getByRole('status')).toContainText('€12.50');\n", ""), "--assertion-lock")
    assert any("removed" in p for p in problems if p.startswith("assertion lock")), problems

    # without a snapshot the lock cannot be checked: rejected, not skipped
    kit.path(f"{run}/tests-before/TC-01-add-an-expense.spec.ts").unlink()
    r = kit.run(CHECK, run, "--assertion-lock", expect=1)
    assert "no copy in tests-before/" in r.out

    # a rejected repair is undone from the copy
    kit.write(TEST_FILE, GOOD_TEST)
    kit.run(CHECK, run, "--snapshot", "TC-01", expect=0)
    kit.write(TEST_FILE, "broken")
    kit.run(CHECK, run, "--restore", "TC-01", expect=0)
    assert kit.read(TEST_FILE) == GOOD_TEST


def test_set_aside_tests_are_rejected_and_manual_cases_skipped(kit):
    kit.write("app-map/app-map.yaml", APP_MAP)
    kit.excel("runs/cases.xlsx", [case("TC-01"), case("TC-02", title="Email arrives", automation="manual")])
    run = kit.intake("runs/cases.xlsx")
    kit.write(TEST_FILE, GOOD_TEST)
    kit.write("tests/_removed/TC-02-email-arrives.spec.ts", GOOD_TEST)
    r = kit.run(CHECK, run, expect=0)
    assert "1 accepted, 0 rejected" in r.out                 # only TC-01: manual cases have no test to check
    r = kit.run(CHECK, run, "--files", "tests/_removed/TC-02-email-arrives.spec.ts", expect=1)
    assert "set aside in tests/_removed/" in r.out


def test_rules_follow_the_profile(kit, run):
    kit.run("scripts/features.py", "off", "rule-screenshot-every-step", "--yes", expect=0)
    r, problems = check(kit, run, GOOD_TEST.replace("await shot(2);", ""))
    assert r.returncode == 0, problems
