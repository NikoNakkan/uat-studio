"""The private .env: start page and test accounts. Values are write-only (passwords never come back)."""
from __future__ import annotations

import re
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import accounts, kit

router = APIRouter()


def _env_path() -> Path:
    return kit.KIT_DIR / ".env"


def _env_values() -> dict[str, str]:
    return accounts.env_values()


@router.get("/env")
def get_env():
    values = _env_values()
    overview = accounts.accounts_overview(accounts.latest_cases()[1])
    return {"env_exists": _env_path().exists(), "start_page": values.get("START_PAGE", ""), "accounts": overview,
            "allowed_origins": kit.guardrails().get("allowed_origins", [])}


class EnvIn(BaseModel):
    key: str
    value: str


def _write_env(key: str, value: str) -> None:
    if "\n" in value or "\r" in value:
        raise HTTPException(400, "One line only")
    p = _env_path()
    lines = p.read_text(encoding="utf-8").splitlines() if p.exists() else []
    for n, line in enumerate(lines):
        if re.match(rf"^\s*{re.escape(key)}\s*=", line):
            lines[n] = f"{key}={value}"
            break
    else:
        lines.append(f"{key}={value}")
    p.write_text("\n".join(lines) + "\n", encoding="utf-8")


@router.put("/env")
def put_env(body: EnvIn):
    """Write one value into .env. Passwords are never sent back. A saved user name is, so Setup can show who it is."""
    names = accounts.env_example_accounts()
    allowed = {"START_PAGE", "UAT_SESSION_MAX_AGE_MIN"} | {f"{a}_{s}" for a in names for s in ("USER", "PASSWORD")}
    if body.key not in allowed:
        raise HTTPException(400, "Unknown setting")
    _write_env(body.key, body.value)
    return {"ok": True}


class AccountValuesIn(BaseModel):
    user: str = ""
    password: str = ""


def _known_account(name: str) -> str:
    key = accounts.account_key(name)
    if not re.fullmatch(r"[A-Z0-9_]+", key):
        raise HTTPException(400, "Unknown account")
    known = set(accounts.env_example_accounts()) | {k[:-5] for k in accounts.env_values() if k.endswith("_USER")}
    if key not in known:
        raise HTTPException(400, "Unknown account. Add the person first.")
    return key


@router.put("/env/accounts/{name}")
def put_account(name: str, body: AccountValuesIn):
    """Save a person's user and password together. A blank password keeps the one already saved."""
    key = _known_account(name)
    user = body.user.strip()
    if not user:
        raise HTTPException(400, "Enter the user.")
    password = body.password
    if not password:
        password = accounts.env_values().get(f"{key}_PASSWORD", "")
        if not password:
            raise HTTPException(400, "Enter the password.")
    _write_env(f"{key}_USER", user)
    _write_env(f"{key}_PASSWORD", password)
    return {"ok": True, "label": accounts.account_label(key)}


@router.delete("/env/accounts/{name}")
def clear_account(name: str):
    """Forget the saved user and password. The account name stays, so it can be filled in again."""
    key = _known_account(name)
    _write_env(f"{key}_USER", "")
    _write_env(f"{key}_PASSWORD", "")
    return {"ok": True}


class AccountIn(BaseModel):
    label: str


@router.post("/env/accounts")
def add_account(body: AccountIn):
    key = re.sub(r"[^A-Z0-9]+", "_", body.label.upper()).strip("_")
    if not key:
        raise HTTPException(400, "Give the account a name, e.g. Manager test account")
    p = kit.KIT_DIR / ".env.example"
    text = p.read_text(encoding="utf-8") if p.exists() else ""
    created = f"{key}_USER=" not in text
    if created:
        text = text.rstrip() + f"\n{key}_USER=\n{key}_PASSWORD=\n"
        p.write_text(text + ("\n" if not text.endswith("\n") else ""), encoding="utf-8")
    return {"key": key, "label": accounts.account_label(key), "created": created}
