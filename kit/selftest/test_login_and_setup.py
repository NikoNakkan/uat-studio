"""setting-up-login (check_login.py) and checking-setup (check_setup.py): the parts that need no browser."""
import os

from conftest import case

CHECK_LOGIN = ".github/skills/setting-up-login/scripts/check_login.py"
CHECK_SETUP = ".github/skills/checking-setup/scripts/check_setup.py"
# The host (UAT Studio) hands the start page and the accounts to the scripts as environment variables.
SECRETS = {"START_PAGE": "http://localhost:4173", "EMPLOYEE_TEST_ACCOUNT_USER": "emp@example.com",
           "EMPLOYEE_TEST_ACCOUNT_PASSWORD": "S3cretPassw0rd"}


def test_login_check_needs_a_written_login_ts(kit):
    r = kit.run(CHECK_LOGIN, "--all", env=SECRETS, expect=2)
    assert "tests/login.ts does not know how to log in yet: run /setup-login first" in r.out


def test_login_check_needs_an_account(kit):
    kit.excel("runs/cases.xlsx", [case("TC-01")])
    run = kit.intake("runs/cases.xlsx")
    r = kit.run(CHECK_LOGIN, "--run", run, expect=2)
    assert "No account to check" in r.out


def test_login_check_never_prints_secrets(kit, tmp_path):
    """A fake npx stands in for Playwright and fails with the password in its error: the check must scrub it."""
    kit.write("tests/login.ts", "export async function login() {}\nexport async function expectLoggedIn() {}\n")
    fake = tmp_path / "bin"
    fake.mkdir()
    if os.name == "nt":
        (fake / "npx.cmd").write_text("@echo Error: login failed for emp@example.com with S3cretPassw0rd\r\n@exit /b 1\r\n")
    else:
        script = fake / "npx"
        script.write_text("#!/bin/sh\necho 'Error: login failed for emp@example.com with S3cretPassw0rd'\nexit 1\n")
        script.chmod(0o755)
    r = kit.run(CHECK_LOGIN, "--account", "EMPLOYEE_TEST_ACCOUNT", env={**SECRETS, "PATH": str(fake) + os.pathsep + os.environ.get("PATH", "")})
    assert r.returncode == 1 and "FAIL     EMPLOYEE_TEST_ACCOUNT: Error: login failed for *** with ***" in r.out, r.out
    assert "S3cretPassw0rd" not in r.out and "emp@example.com" not in r.out
    assert "0 of 1 account(s) logged in" in r.out


def test_setup_check_reports_each_requirement(kit):
    kit.excel("runs/cases.xlsx", [case("TC-01", login_as="Employee test account")])
    run = kit.intake("runs/cases.xlsx")
    r = kit.run(CHECK_SETUP, "--run", run)
    assert r.returncode in (0, 1)
    for text in ["MISSING  account value EMPLOYEE_TEST_ACCOUNT_USER",
                 "MISSING  account value EMPLOYEE_TEST_ACCOUNT_PASSWORD", "MISSING  tests/login.ts knows how to log in",
                 "OK       Feature switches", "Result: something required is missing or broken"]:
        assert text in r.out, text
    assert r.returncode == 1


def test_setup_check_takes_the_values_from_the_environment_and_never_prints_them(kit):
    kit.excel("runs/cases.xlsx", [case("TC-01", login_as="Employee test account")])
    run = kit.intake("runs/cases.xlsx")
    r = kit.run(CHECK_SETUP, "--run", run, env=SECRETS)
    assert "MISSING  START_PAGE" not in r.out
    assert "OK       account value EMPLOYEE_TEST_ACCOUNT_PASSWORD" in r.out
    assert "S3cretPassw0rd" not in r.out and "emp@example.com" not in r.out


def test_a_env_file_is_not_read(kit):
    """There is no .env any more: a stray file in the kit must not count as a value."""
    kit.write(".env", "EMPLOYEE_TEST_ACCOUNT_USER=emp@example.com\nEMPLOYEE_TEST_ACCOUNT_PASSWORD=S3cretPassw0rd\n")
    kit.excel("runs/cases.xlsx", [case("TC-01", login_as="Employee test account")])
    run = kit.intake("runs/cases.xlsx")
    r = kit.run(CHECK_SETUP, "--run", run)
    assert "MISSING  account value EMPLOYEE_TEST_ACCOUNT_PASSWORD" in r.out
