"""Feature switches: what is on, and switching parts off and on with their dependencies."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import kit

router = APIRouter()


@router.get("/features")
def get_features():
    f = kit.features_module()
    items, off = f.load_items(), f.load_off()
    on = f.effective_on(items, off)
    out = []
    for i, it in items.items():
        out.append({**it, "on": i in on, "switched_off": i in off,
                    "required_by": [d for d, x in items.items() if i in x["requires"]],
                    "soft_by": [{"id": d, "loss": s["loss"]} for d, x in items.items() for s in x["soft"] if s["id"] == i],
                    "needs_all": f.needs_closure(items, i),
                    "blocked_by": [r for r in f.needs_closure(items, i) if r not in on] if f.built(it) else []})
    switched_off = {i for i in items if f.built(items[i]) and i not in on}
    losses = [{"who": w, "dep": d, "loss": loss} for w, d, loss in f.soft_losses(items, on, switched_off)]
    return {"items": out, "losses": losses, "problems": f.problems(items, off)}


class SwitchIn(BaseModel):
    id: str
    action: str           # off | on
    apply: bool = False


@router.post("/features/switch")
def switch_feature(body: SwitchIn):
    f = kit.features_module()
    items, off = f.load_items(), f.load_off()
    if body.id not in items:
        raise HTTPException(404, "Unknown part")
    it, on = items[body.id], f.effective_on(items, off)
    if body.action == "off":
        if it["core"]:
            return {"allowed": False, "reason": f"It is core: {it.get('core_reason') or 'the flow does not work without it.'}"}
        cascade = [d for d in f.dependents_closure(items, body.id) if d in on]
        blocked = [d for d in cascade if items[d]["core"]]
        if blocked:
            return {"allowed": False, "reason": "Core parts need it: " + ", ".join(items[b]["name"] for b in blocked)}
        gone = {body.id, *cascade}
        losses = [{"who": w, "dep": d, "loss": line} for w, d, line in f.soft_losses(items, on - gone, gone)]
        if body.apply:
            f.save_off(items, off | gone)
        return {"allowed": True, "also": cascade, "losses": losses, "applied": body.apply}
    if body.action == "on":
        if not f.built(it):
            return {"allowed": False, "reason": f"It is {it['status']} (not built)."}
        needed = [r for r in f.needs_closure(items, body.id) if r not in on]
        if any(not f.built(items[r]) for r in needed):
            return {"allowed": False, "reason": "It needs parts that are not built."}
        if body.apply:
            f.save_off(items, off - {body.id, *needed})
        return {"allowed": True, "also": needed, "losses": [], "applied": body.apply}
    raise HTTPException(400, "action is off or on")
