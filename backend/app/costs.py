"""What a run cost: its recorded token use (usage.json) priced per model, in US dollars.

Rows recorded since Studio splits out cached tokens are exact. Older rows count cached tokens as plain input,
so their price is the most the work could have cost; the summary says so with `estimated`.
"""
from __future__ import annotations

from .catalog import MODELS

CACHE_READ = 0.1      # a cache read costs a tenth of the input price
CACHE_WRITE = 1.25    # a five-minute cache write costs a quarter more than the input price
GROUPS = ("stage", "agent", "model")


def _model_id(model: str) -> str:
    # The kit writes "<id> (first of N)" when an agent file lists several models.
    return model.split(" ", 1)[0]


def price(row: dict) -> float | None:
    """One usage row in dollars; None when the model has no known price."""
    info = MODELS.get(_model_id(row.get("model", "")))
    if not info:
        return None
    total_in = row.get("input_tokens", 0)
    read, write = row.get("cache_read_tokens", 0), row.get("cache_write_tokens", 0)
    plain = max(0, total_in - read - write)
    per_in, per_out = info.input_price / 1e6, info.output_price / 1e6
    return plain * per_in + read * per_in * CACHE_READ + write * per_in * CACHE_WRITE + row.get("output_tokens", 0) * per_out


def summarise(rows: list[dict]) -> dict:
    """The total and a breakdown by stage, agent and model, biggest first."""
    groups: dict[str, dict[str, dict]] = {g: {} for g in GROUPS}
    total, unpriced, estimated = 0.0, [], False
    tokens = {"input": 0, "output": 0, "cache_read": 0, "cache_write": 0}
    for row in rows:
        cost = price(row)
        if cost is None:
            unpriced.append(row.get("model", "?"))
            cost = 0.0
        estimated |= "cache_read_tokens" not in row
        total += cost
        tokens["input"] += row.get("input_tokens", 0)
        tokens["output"] += row.get("output_tokens", 0)
        tokens["cache_read"] += row.get("cache_read_tokens", 0)
        tokens["cache_write"] += row.get("cache_write_tokens", 0)
        for g in GROUPS:
            key = row.get(g) or "?"
            if g == "model":
                key = _model_id(key)
            item = groups[g].setdefault(key, {"key": key, "cost": 0.0, "calls": 0, "input": 0, "output": 0})
            item["cost"] += cost
            item["calls"] += 1
            item["input"] += row.get("input_tokens", 0)
            item["output"] += row.get("output_tokens", 0)
    out = {g: sorted(groups[g].values(), key=lambda i: -i["cost"]) for g in GROUPS}
    for items in out.values():
        for i in items:
            i["cost"] = round(i["cost"], 4)
    return {"total": round(total, 4), "calls": len(rows), "estimated": bool(rows) and estimated,
            "unpriced": sorted(set(unpriced)), "tokens": tokens,
            "by_stage": out["stage"], "by_agent": out["agent"], "by_model": out["model"]}
