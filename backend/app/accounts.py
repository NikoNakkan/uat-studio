"""Test accounts and the Excel in use: which accounts exist, whether their values are filled in (never the
values themselves), which cases use them, and which test cases Studio knows best."""
from __future__ import annotations

import re
from pathlib import Path

from .kit import kit_dir, list_runs, read_json, runs_dir


def env_example_accounts() -> list[str]:
    p = kit_dir() / ".env.example"
    if not p.exists():
        return []
    return re.findall(r"^([A-Z0-9_]+)_USER=", p.read_text(encoding="utf-8"), re.M)


def env_values() -> dict[str, str]:
    """The project's private values (start page, accounts): kept by Studio, with an old .env as fallback.
    Only the app reads them; agents never see these values."""
    from . import projects, vault  # noqa: PLC0415 - projects imports this module's neighbours
    return vault.values(projects.current_id(), kit_dir())


def account_key(name: str) -> str:
    """'Employee test account' -> 'EMPLOYEE_TEST_ACCOUNT' (same rule as the kit's scripts/common.py)."""
    return re.sub(r"[^A-Z0-9]+", "_", str(name or "").upper()).strip("_")


def account_label(name: str) -> str:
    """'EMPLOYEE_TEST_ACCOUNT' -> 'Employee test account'."""
    words = [w for w in str(name or "").split("_") if w]
    if not words:
        return name
    return " ".join([words[0].capitalize(), *(w.lower() for w in words[1:])])


def cases_source() -> dict:
    """Which test cases Studio knows best: the newer of the newest run's and the Excel given to login setup.
    {"source": "run <id>" | "login setup" | "", "excel": file name, "file": cases.json, "xlsx": the Excel itself,
    "cases": [...]}."""
    found = []
    for run_id in list_runs():
        run = runs_dir() / run_id
        if not (run / "input.xlsx").exists():
            continue
        cases_file = run / "cases.json"       # missing until the run has read its Excel
        excel = (read_json(run / "progress.json", {}) or {}).get("excel", "")
        found.append({"source": f"run {run_id}", "excel": Path(excel).name, "cases": read_json(cases_file, []) or [],
                      "file": cases_file if cases_file.exists() else run / "input.xlsx", "xlsx": run / "input.xlsx"})
        break
    f = runs_dir() / "setup" / "cases.json"
    cases = read_json(f)
    if cases:
        name = runs_dir() / "setup" / "requirements-name.txt"
        found.append({"source": "login setup", "file": f, "cases": cases, "xlsx": runs_dir() / "setup" / "requirements.xlsx",
                      "excel": name.read_text(encoding="utf-8").strip() if name.exists() else "requirements.xlsx"})
    if not found:
        return {"source": "", "excel": "", "file": None, "cases": [], "xlsx": None}
    return max(found, key=lambda x: x["file"].stat().st_mtime)


def latest_cases() -> tuple[str, list[dict]]:
    """The test cases the login agent and the account list start from (see cases_source)."""
    s = cases_source()
    return (f"{s['excel']} ({s['source']})" if s["source"] else ""), s["cases"]


def accounts_overview(cases: list[dict]) -> list[dict]:
    """Every test account Studio knows of: entered on the Setup page or named in the cases' "Login as".
    Says whether its values are filled in (never the values) and which cases use it."""
    values = env_values()
    used: dict[str, list[str]] = {}
    for c in cases:
        if c.get("login_as"):
            used.setdefault(account_key(c["login_as"]), []).append(c.get("test_id", "?"))
    names = list(dict.fromkeys([*env_example_accounts(), *(k[:-5] for k in values if k.endswith("_USER")), *used]))
    return [{"name": n, "label": account_label(n), "user": values.get(f"{n}_USER", ""),
             "user_set": bool(values.get(f"{n}_USER")), "password_set": bool(values.get(f"{n}_PASSWORD")),
             "used_by": used.get(n, [])} for n in names]
