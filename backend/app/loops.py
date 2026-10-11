"""The places where the flow goes back to an earlier stage, and how often a run went back (for the stepper)."""
from __future__ import annotations

# (from stage, back to stage, why, the run state that counts the rounds)
LOOPS = [
    ("planner_check", "clarify", "Steps that do not match the live app go back to clarification", "planner_rounds"),
    ("test_check", "generate", "Tests the check rejects go back to the generator", "test_check_rounds"),
]


def of_run(state: dict, stage_ids: list[str]) -> list[dict]:
    """Every loop whose stages are in this flow, with how many times this run went round it."""
    out = []
    for frm, to, why, key in LOOPS:
        if frm not in stage_ids or to not in stage_ids:
            continue
        count = state.get(key) or 0
        if key == "test_check_rounds" and not count:          # runs from before the rounds were counted
            count = max((state.get("generate_attempts") or {}).values(), default=0)
        out.append({"from": frm, "to": to, "label": why, "count": count})
    return out
