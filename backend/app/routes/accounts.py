"""The project's private values: start page and test accounts, kept by Studio (vault.py), write-only:
passwords never come back."""
from __future__ import annotations

import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import accounts, kit, projects, vault

router = APIRouter()


def _env_values() -> dict[str, str]:
    return accounts.env_values()


@router.get("/env")
def get_env():
    values = _env_values()
    overview = accounts.accounts_overview(accounts.latest_cases()[1])
    return {"env_exists": bool(values), "start_page": values.get("START_PAGE", ""), "accounts": overview,
            "allowed_origins": kit.guardrails().get("allowed_origins", [])}


class EnvIn(BaseModel):
    key: str
    value: str


def _write_env(key: str, value: str) -> None:
    """Studio keeps the value itself (vault.py); the project folder gets no .env."""
    try:
        vault.put(projects.current_id(), key, value)
    except ValueError as e:
        raise HTTPException(400, str(e)) from None

@router.put("/env")
def put_env(body: EnvIn):
    """Save one private value. Passwords are never sent back. A saved user name is, so Setup can show who it is."""
    names = {a['name'] for a in accounts.accounts_overview(accounts.latest_cases()[1])}
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
    # the accounts the Excel names in its "Login as" column can be filled in without adding them first
    named = {accounts.account_key(c["login_as"]) for c in accounts.latest_cases()[1] if c.get("login_as")}
    known = set(accounts.added_accounts()) | {k[:-5] for k in accounts.env_values() if k.endswith("_USER")} | named
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
    created = vault.add_account(projects.current_id(), key)
    return {"key": key, "label": accounts.account_label(key), "created": created}
