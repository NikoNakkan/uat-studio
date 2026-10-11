"""Switch parts of the UAT flow on and off, with their dependencies (config/features.yaml).

Usage:
  python scripts/features.py status              what is off, and what works less well because of it
  python scripts/features.py why <id>            what a part needs, and what needs it
  python scripts/features.py off <id> [--yes]    switch off, together with everything that cannot work without it
  python scripts/features.py on <id> [--yes]     switch on, together with everything it needs
  python scripts/features.py is-on <id>          prints ON or OFF (exit 0 = on, 1 = off): used by the orchestrator
  python scripts/features.py check               checks the map and the profile (exit 1 = problems)
  python scripts/features.py page [out.html]     writes the interactive switch page (default: feature-switches.html)

Without --yes, off and on only show what would change. The choices are saved in config/profile.yaml.
Other scripts import is_on() from here.
"""
import json
import sys
from datetime import date
from functools import lru_cache
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
FEATURES = ROOT / "config" / "features.yaml"
PROFILE = ROOT / "config" / "profile.yaml"
TEMPLATE = ROOT / "scripts" / "feature_page.html"
PROFILE_HEADER = """# Parts of the UAT flow that are switched off. Everything built and not listed here is on.
# Change it with: python scripts/features.py off <id>   (shows what else switches off, then asks)
#                 python scripts/features.py on <id>    (switches on what it needs, too)
# or paste the profile from the switch page (python scripts/features.py page).
# Ids and dependencies: config/features.yaml
"""


def load_items():
    items = yaml.safe_load(FEATURES.read_text(encoding="utf-8"))["items"]
    for it in items:
        it.setdefault("requires", [])
        it.setdefault("soft", [])
        it.setdefault("status", "built")
        it.setdefault("core", False)
    return {it["id"]: it for it in items}


def load_off():
    data = yaml.safe_load(PROFILE.read_text(encoding="utf-8")) if PROFILE.exists() else None
    return set((data or {}).get("switched_off") or [])   # not "off": YAML reads that word as false


def save_off(items, off):
    ordered = [i for i in items if i in off]
    PROFILE.write_text(PROFILE_HEADER + "\nswitched_off:" +("".join(f"\n  - {i}" for i in ordered) if ordered else " []") + "\n",
                       encoding="utf-8")


def built(it):
    return it["status"] == "built"


def effective_on(items, off):
    """A part is on when it is built, not switched off, and everything it needs is on."""
    memo = {}

    def on(i, seen=()):
        if i in memo:
            return memo[i]
        it = items[i]
        result = built(it) and i not in off and all(on(r, seen + (i,)) for r in it["requires"] if r not in seen)
        memo[i] = result
        return result

    return {i for i in items if on(i)}


def needs_closure(items, i):
    out, todo = [], list(items[i]["requires"])
    while todo:
        r = todo.pop(0)
        if r not in out:
            out.append(r)
            todo += items[r]["requires"]
    return out


def dependents_closure(items, i):
    out, todo = [], [i]
    while todo:
        cur = todo.pop(0)
        for d, it in items.items():
            if cur in it["requires"] and d not in out:
                out.append(d)
                todo.append(d)
    return out


def soft_losses(items, on, gone):
    """Losses for parts that stay on while a soft dependency of theirs is off."""
    return [(i, s["id"], s["loss"]) for i, it in items.items() if i in on
            for s in it["soft"] if s["id"] in gone]


def name(items, i):
    return f"{items[i]['name']} [{i}]"


@lru_cache(maxsize=1)
def _on_now():
    items = load_items()
    return frozenset(effective_on(items, load_off()))


def is_on(feature_id):
    """For other scripts: True when the part is switched on (unknown ids count as on)."""
    items = load_items()
    return feature_id not in items or feature_id in _on_now()


def problems(items, off):
    found = []
    for i, it in items.items():
        for r in it["requires"] + [s["id"] for s in it["soft"]]:
            if r not in items:
                found.append(f"{i}: depends on unknown id '{r}'")
    if found:
        return found
    for i, it in items.items():
        if i in needs_closure(items, i):
            found.append(f"{i}: depends on itself (a cycle)")
        if it["core"]:
            found += [f"{i} is core but needs {r}, which is not core" for r in it["requires"] if not items[r]["core"]]
        if built(it):
            found += [f"{i} is built but needs {r}, which is {items[r]['status']}" for r in it["requires"]
                      if not built(items[r])]
    for i in off:
        if i not in items:
            found.append(f"profile: unknown id '{i}'")
        elif items[i]["core"]:
            found.append(f"profile: {i} is core and cannot be switched off")
    on = effective_on(items, off)
    for i, it in items.items():
        if built(it) and i not in off and i not in on:
            missing = [r for r in needs_closure(items, i) if r in off]
            found.append(f"profile: {i} is not listed as off, but cannot work because {', '.join(missing)} is off")
    return found


def cmd_off(items, off, i, yes):
    it = items[i]
    if it["core"]:
        print(f"Cannot switch off {name(items, i)}: it is core: {it.get('core_reason') or 'the flow does not work without it.'}")
        return 1
    on = effective_on(items, off)
    if i not in on:
        print(f"{name(items, i)} is already off.")
        return 0
    cascade = [d for d in dependents_closure(items, i) if d in on]
    blocked = [d for d in cascade if items[d]["core"]]
    if blocked:
        print(f"Cannot switch off {name(items, i)}: core parts need it: {', '.join(name(items, b) for b in blocked)}.")
        return 1
    gone = {i, *cascade}
    print(f"Switching off: {name(items, i)}")
    for d in cascade:
        print(f"  also off (cannot work without it): {name(items, d)}")
    for who, dep, loss in soft_losses(items, on - gone, gone):
        print(f"  works less well: {name(items, who)} - {loss}")
    if not yes:
        print("Nothing changed. Add --yes to apply.")
        return 0
    save_off(items, off | gone)
    print(f"Saved to {PROFILE.relative_to(ROOT).as_posix()}.")
    return 0


def cmd_on(items, off, i, yes):
    it = items[i]
    if not built(it):
        print(f"Cannot switch on {name(items, i)}: it is {it['status']} (not built).")
        return 1
    on = effective_on(items, off)
    if i in on:
        print(f"{name(items, i)} is already on.")
        return 0
    needed = [r for r in needs_closure(items, i) if r not in on]
    unbuilt = [r for r in needed if not built(items[r])]
    if unbuilt:
        print(f"Cannot switch on {name(items, i)}: it needs parts that are not built: {', '.join(unbuilt)}.")
        return 1
    print(f"Switching on: {name(items, i)}")
    for r in needed:
        print(f"  also on (it needs it): {name(items, r)}")
    if not yes:
        print("Nothing changed. Add --yes to apply.")
        return 0
    save_off(items, off - {i, *needed})
    print(f"Saved to {PROFILE.relative_to(ROOT).as_posix()}.")
    return 0


def cmd_why(items, off, i):
    on = effective_on(items, off)
    it = items[i]
    mark = lambda x: "on " if x in on else ("planned" if items[x]["status"] == "planned" else "OFF")
    print(f"{name(items, i)}: {it['kind']}, {'core, ' if it['core'] else ''}{it['status']}, {mark(i).strip()}")
    print(f"  {it['what']}")

    def tree(x, depth, seen):
        for r in items[x]["requires"]:
            print(f"  {'   ' * depth}needs {mark(r):<7} {name(items, r)}")
            if r not in seen:
                tree(r, depth + 1, seen | {r})

    if it["requires"]:
        print("Needs:")
        tree(i, 0, {i})
    for s in it["soft"]:
        print(f"Works less well without {name(items, s['id'])} ({mark(s['id']).strip()}): {s['loss']}")
    direct = [d for d, x in items.items() if i in x["requires"]]
    if direct:
        print("Needed by: " + ", ".join(name(items, d) for d in direct))
        rest = [d for d in dependents_closure(items, i) if d not in direct]
        if rest:
            print("  and through them: " + ", ".join(name(items, d) for d in rest))
    for d, x in items.items():
        for s in x["soft"]:
            if s["id"] == i:
                print(f"Makes {name(items, d)} better: without it, {s['loss'][0].lower() + s['loss'][1:]}")
    return 0


def cmd_status(items, off):
    on = effective_on(items, off)
    builts = [i for i in items if built(items[i])]
    print(f"On {len([i for i in builts if i in on])} · off {len([i for i in builts if i not in on])} · "
          f"core {sum(items[i]['core'] for i in builts)} · planned {sum(items[i]['status'] == 'planned' for i in items)} · "
          f"set aside {sum(items[i]['status'] == 'set-aside' for i in items)}")
    for i in builts:
        if i not in on:
            print(f"  OFF  {name(items, i)}")
    for who, dep, loss in soft_losses(items, on, {i for i in builts if i not in on}):
        print(f"  works less well: {name(items, who)} - {loss}")
    return 0


def cmd_page(items, off, out):
    data = {"items": list(items.values()), "off": sorted(off), "generated": date.today().isoformat()}
    html = TEMPLATE.read_text(encoding="utf-8").replace("/*__FEATURE_DATA__*/null",
                                                        json.dumps(data, ensure_ascii=False).replace("</", "<\\/"))
    out.write_text(html, encoding="utf-8")
    print(f"Wrote {out.relative_to(ROOT).as_posix() if out.is_relative_to(ROOT) else out}")
    return 0


def main(argv):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 2
    items, off = load_items(), load_off()
    cmd, args = argv[0], argv[1:]
    yes = "--yes" in args
    args = [a for a in args if a != "--yes"]
    if cmd == "check":
        found = problems(items, off)
        print("\n".join(f"  - {p}" for p in found) if found else f"Feature map OK: {len(items)} parts, {len(off)} switched off.")
        return 1 if found else 0
    if cmd == "status":
        return cmd_status(items, off)
    if cmd == "page":
        return cmd_page(items, off, Path(args[0]) if args else ROOT / "feature-switches.html")
    if cmd in ("why", "off", "on", "is-on"):
        if len(args) != 1:
            print(f"Usage: features.py {cmd} <id>")
            return 2
        i = args[0]
        if i not in items:
            close = [x for x in items if i in x]
            print(f"Unknown id '{i}'." + (f" Did you mean: {', '.join(close)}?" if close else ""))
            return 2
        if cmd == "is-on":
            on = i in effective_on(items, off)
            print("ON" if on else "OFF")
            return 0 if on else 1
        return {"why": lambda: cmd_why(items, off, i), "off": lambda: cmd_off(items, off, i, yes),
                "on": lambda: cmd_on(items, off, i, yes)}[cmd]()
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
