"""Self-tests of the kit's Python scripts.

Every test gets its own copy of the kit (config, scripts, skills, templates, tests/*.ts) in a
temporary folder and runs the scripts there with subprocess, exactly as an agent would. Nothing in
the real repository is touched; node_modules is not copied (no script needs it to be checked).

Run: python scripts/selftest.py        (or: pytest selftest/ -q)
"""
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
import yaml
from openpyxl import Workbook

REPO = Path(__file__).resolve().parents[1]
COPY = ["config", "scripts", ".github", "templates", "examples", "app-map", "specs",
        ".env.example", "AGENTS.md", "GLOSSARY.md", "package.json", "playwright.config.ts"]
COPY_TESTS = ["fixtures.ts", "login.ts", "login.check.spec.ts", "seed.spec.ts"]
START = "http://localhost:4173"


def _ignore(_, names):
    return {n for n in names if n in ("__pycache__", "node_modules") or n.endswith(".pyc")}


class Kit:
    """A disposable copy of the kit. run("scripts/progress.py", "latest") runs that script inside it."""

    def __init__(self, root: Path):
        self.root = root

    # files
    def path(self, rel):
        return self.root / rel

    def read(self, rel):
        return self.path(rel).read_text(encoding="utf-8")

    def write(self, rel, text):
        p = self.path(rel)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
        return p

    def json(self, rel):
        return json.loads(self.read(rel))

    def write_json(self, rel, data):
        self.write(rel, json.dumps(data, indent=2, ensure_ascii=False))

    def yaml(self, rel):
        return yaml.safe_load(self.read(rel))

    # scripts
    def run(self, script, *args, stdin=None, env=None, expect=None):
        full_env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1")
        full_env.pop("UAT_RUN_DIR", None)
        if env:
            full_env.update(env)
        r = subprocess.run([sys.executable, str(self.root / script), *map(str, args)], cwd=self.root,
                           input=stdin, capture_output=True, text=True, encoding="utf-8", env=full_env)
        r.out = (r.stdout or "") + (r.stderr or "")
        if expect is not None:
            assert r.returncode == expect, f"{script} {' '.join(map(str, args))} -> exit {r.returncode}, wanted {expect}\n{r.out}"
        return r

    # common steps
    def new_run(self, excel="examples/expense-tracker-tests.xlsx", strictness="standard"):
        r = self.run("scripts/progress.py", "new", excel, "--strictness", strictness, expect=0)
        m = re.search(r"^RUN (runs/\S+)", r.out, re.M)
        assert m, r.out
        return m.group(1)

    def intake(self, excel, expect_valid=True):
        """progress new + read_excel + validate. Returns the run folder (relative)."""
        run = self.new_run(excel)
        self.run(".github/skills/reading-uat-excel/scripts/read_excel.py", excel, f"{run}/cases.json", expect=0)
        r = self.run(".github/skills/reading-uat-excel/scripts/validate.py", f"{run}/cases.json")
        if expect_valid:
            assert r.returncode == 0, r.out
        return run

    def excel(self, rel, rows):
        """Write an Excel file in the template's layout (headers from config/excel-template.yaml)."""
        columns = self.yaml("config/excel-template.yaml")["columns"]
        wb = Workbook()
        ws = wb.active
        ws.title = "Test cases"
        ws.append([c["header"] + (" *" if c["required"] else "") for c in columns.values()])
        for row in rows:
            ws.append([row.get(k, "") for k in columns])
        p = self.path(rel)
        p.parent.mkdir(parents=True, exist_ok=True)
        wb.save(p)
        return rel

    def hook(self, call):
        """Feed one tool call to the guard hook. Returns (decision or None, reason)."""
        r = self.run("scripts/guard_hook.py", stdin=json.dumps(call) if not isinstance(call, str) else call, expect=0)
        if not r.stdout.strip():
            return None, ""
        out = json.loads(r.stdout)["hookSpecificOutput"]
        return out["permissionDecision"], out["permissionDecisionReason"]


@pytest.fixture
def kit(tmp_path):
    root = tmp_path / "kit"
    root.mkdir()
    for name in COPY:
        src = REPO / name
        if src.is_dir():
            shutil.copytree(src, root / name, ignore=_ignore)
        elif src.exists():
            shutil.copyfile(src, root / name)
    (root / "tests").mkdir()
    for name in COPY_TESTS:
        shutil.copyfile(REPO / "tests" / name, root / "tests" / name)
    # tests/login.ts in the repository is written for whichever app the kit tests; the self-tests start blank.
    shutil.copyfile(REPO / "templates" / "login.ts", root / "tests" / "login.ts")
    (root / "runs").mkdir()
    (root / "runs" / ".gitkeep").touch()
    return Kit(root)


# --- Reusable pieces -------------------------------------------------------------------------

def case(test_id, group="Expenses", title="Add an expense", steps=None, expected=None, **extra):
    row = {"test_id": test_id, "group": group, "title": title, "start_page": START,
           "steps": steps or '1. Type "Taxi" in Description\n2. Type 12.50 in Amount (EUR)\n3. Click "Add expense"',
           "expected_results": expected or '3. The status message shows "Added Taxi"\n3. The total shows "€12.50"'}
    row.update(extra)
    return row


APP_MAP = """pages:
  expenses:
    address: http://localhost:4173/
    reached_by: start page
    elements:
      - {role: textbox, name: Description}
      - {role: spinbutton, name: Amount (EUR)}
      - {role: button, name: Add expense}
      - {role: status, name: '', example_text: Added Taxi}
      - {role: list, name: Expenses}
"""

GOOD_TEST = """import { test, expect } from '../fixtures';

test('TC-01 Add an expense', async ({ page, shot }) => {
  await page.goto('http://localhost:4173/');
  // 1. Type "Taxi" in Description
  await page.getByRole('textbox', { name: 'Description' }).fill('Taxi');
  await shot(1);
  // 2. Type 12.50 in Amount (EUR)
  await page.getByRole('spinbutton', { name: 'Amount (EUR)' }).fill('12.50');
  await shot(2);
  // 3. Click "Add expense"
  await page.getByRole('button', { name: 'Add expense' }).click();
  const status = page.getByRole('status');
  await expect(status).toContainText('Added Taxi');
  await expect(page.getByRole('status')).toContainText('€12.50');
  await shot(3);
});
"""
