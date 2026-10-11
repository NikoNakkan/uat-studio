"""Small helpers shared by the scripts (imported with sys.path pointing at scripts/)."""
import hashlib
import json
import re
import subprocess
from pathlib import Path
from urllib.parse import urlparse

import yaml

ROOT = Path(__file__).resolve().parents[1]


def account_key(name):
    """'Employee test account' -> 'EMPLOYEE_TEST_ACCOUNT' (the prefix used in .env)."""
    return re.sub(r"[^A-Z0-9]+", "_", str(name or "").upper()).strip("_")


def is_manual(case):
    """The Excel's Automation column says 'manual': a person performs this case; nothing is generated or run."""
    return str(case.get("automation") or "").strip().lower() == "manual"


def test_files_of(test_id):
    """Test files of a case, newest-named first. Tests set aside in tests/_removed/ never count."""
    return sorted(p for p in ROOT.glob(f"tests/**/{test_id}-*.spec.ts") if "_removed" not in p.parts)


def test_file_of(test_id):
    found = test_files_of(test_id)
    return found[0] if found else None


def allowed_origins():
    return yaml.safe_load((ROOT / "config" / "guardrails.yaml").read_text(encoding="utf-8"))["allowed_origins"]


def origin_of(url):
    """'https://User@Org.CRM.dynamics.com:443/x' -> 'https://org.crm.dynamics.com:443' (no user info, lower case)."""
    p = urlparse(str(url))
    host = (p.hostname or "").lower()
    return f"{p.scheme.lower()}://{host}" + (f":{p.port}" if p.port else "")


def _origin_pattern(entry):
    """An allowed_origins entry may start with '*.' for any subdomain: 'https://*.crm.dynamics.com'.
    The star stands for one or more whole host labels; it never matches '/', '@', ':' or the domain itself."""
    entry = entry.strip().rstrip("/").lower()
    return re.compile("^" + re.escape(entry).replace(r"\*", r"[a-z0-9-]+(?:\.[a-z0-9-]+)*") + "$")


def origin_allowed(url, allowed=None):
    """True when the site of url is in config/guardrails.yaml allowed_origins (wildcards allowed)."""
    target = origin_of(url)
    return any(_origin_pattern(a).match(target) for a in (allowed if allowed is not None else allowed_origins()))


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# progress.json holds the test results (evidence) and the stage bookkeeping, which keeps changing after the
# sign-off is sealed (writing results.xlsx is itself a stage). The seal covers everything but the bookkeeping.
PROGRESS_SEAL = "progress-without-stages:"


def seal_digest(path):
    """The digest a sign-off seal records for one file (see PROGRESS_SEAL for progress.json)."""
    path = Path(path)
    if path.name != "progress.json":
        return sha256_file(path)
    data = json.loads(path.read_text(encoding="utf-8"))
    data.pop("stages", None)
    return PROGRESS_SEAL + hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()


def tool_versions():
    """Versions that identify what a run was made with. Missing tools are reported as 'unknown'."""
    out = {}
    pkg = ROOT / "node_modules" / "@playwright" / "test" / "package.json"
    out["playwright"] = json.loads(pkg.read_text(encoding="utf-8"))["version"] if pkg.exists() else "unknown"
    try:
        out["node"] = subprocess.run(["node", "--version"], capture_output=True, text=True, shell=True).stdout.strip() or "unknown"
    except Exception:  # noqa: BLE001
        out["node"] = "unknown"
    try:
        r = subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, cwd=ROOT, shell=True)
        out["kit_git"] = r.stdout.strip() if r.returncode == 0 else "not a git checkout"
    except Exception:  # noqa: BLE001
        out["kit_git"] = "unknown"
    return out
