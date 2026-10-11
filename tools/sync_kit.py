"""Copy the UAT kit into this repository (kit/) as a clean kit: its code, rules and templates, without this
computer's secrets or anything generated for one app.

    python tools/sync_kit.py [source]        source defaults to ../agentic-testing-kit next to uat-studio

Left out: .env and key files, runs/, node_modules/, Playwright output, and what a run generates for an app (the
tests per group, seeds, plans, the app map, the written tests/login.ts, which goes back to the template).
Run it again after changing the kit; it replaces kit/ completely.
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
TARGET = REPO / "kit"
SKIP_NAMES = {".env", "key.txt", "node_modules", "runs", ".playwright-mcp", ".pytest_cache", "__pycache__", "test-results",
              "playwright-report", ".playwright-ms-auth", ".venv", ".run"}
SKIP_SUFFIXES = {".key", ".pyc"}
KEEP_IN_TESTS = {"fixtures.ts", "canvas.ts", "canvas-fixtures.ts", "login.check.spec.ts", "seed.spec.ts"}
ONLY_README = {"specs", "app-map"}                  # generated per app; the folder and its README stay


def ignore(folder: str, names: list[str]) -> set[str]:
    here = Path(folder)
    skip = {n for n in names if n in SKIP_NAMES or Path(n).suffix in SKIP_SUFFIXES}
    if here.name in ONLY_README and here.parent == SOURCE:
        skip |= {n for n in names if n != "README.md"}
    if here.name == "tests" and here.parent == SOURCE:
        skip |= {n for n in names if n not in KEEP_IN_TESTS}
    return skip


def main() -> int:
    if not (SOURCE / "config" / "workflow.yaml").exists():
        print(f"No kit at {SOURCE}")
        return 2
    if TARGET.exists():
        shutil.rmtree(TARGET)
    shutil.copytree(SOURCE, TARGET, ignore=ignore)
    (TARGET / "runs").mkdir()
    (TARGET / "runs" / ".gitkeep").write_text("", encoding="utf-8")
    shutil.copy2(SOURCE / "templates" / "login.ts", TARGET / "tests" / "login.ts")   # login is written per app
    leaked = [p for p in TARGET.rglob("*") if p.name in {".env", "key.txt"}]
    if leaked:
        print(f"Refusing to leave secrets in kit/: {leaked}")
        shutil.rmtree(TARGET)
        return 1
    files = sum(1 for p in TARGET.rglob("*") if p.is_file())
    print(f"Copied the kit from {SOURCE} to {TARGET.relative_to(REPO)}: {files} files")
    return 0


SOURCE = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else (REPO.parent / "agentic-testing-kit").resolve()

if __name__ == "__main__":
    sys.exit(main())
