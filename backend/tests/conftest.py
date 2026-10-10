"""Every test runs against a throw-away copy of the kit and a throw-away settings folder."""
import os
import shutil
import sys
import tempfile
from pathlib import Path

import pytest

REAL_KIT = Path(__file__).resolve().parents[3] / "agentic-testing-kit"
TMP = Path(tempfile.mkdtemp(prefix="uatstudio-"))
KIT = TMP / "kit"
shutil.copytree(REAL_KIT, KIT, ignore=shutil.ignore_patterns("node_modules", "__pycache__", ".pytest_cache", "current"))
for p in (KIT / "runs").iterdir():
    if p.is_dir():
        shutil.rmtree(p)
os.environ["UAT_KIT_DIR"] = str(KIT)
os.environ["UAT_STUDIO_HOME"] = str(TMP / "home")
os.environ.pop("ANTHROPIC_API_KEY", None)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture(scope="session")
def kit_dir():
    return KIT


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient

    from app.main import app
    with TestClient(app) as c:
        yield c


def pytest_sessionfinish(session, exitstatus):
    shutil.rmtree(TMP, ignore_errors=True)
