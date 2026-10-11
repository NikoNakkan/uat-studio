"""Check generated or repaired Playwright tests against config/test-check-rules.yaml.

Usage:
  python check_tests.py runs/<run-id> [--files tests/a.spec.ts ...] [--assertion-lock]
  python check_tests.py runs/<run-id> --snapshot <TestID>      (before a repair: keep a copy)
  python check_tests.py runs/<run-id> --restore <TestID>       (a repair was rejected: put the copy back)

Without --files it checks the test file of every case in cases.json that has one.
--assertion-lock compares each file with its copy in runs/<run-id>/tests-before/.
Writes runs/<run-id>/test-check.json. Exit 0 = all accepted, 1 = something rejected, 2 = usage error.
"""
import argparse
import difflib
import json
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

import yaml

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "scripts"))
from common import account_key, allowed_origins, is_manual, origin_allowed, test_file_of  # noqa: E402
from features import is_on  # noqa: E402

RULES = yaml.safe_load((ROOT / "config" / "test-check-rules.yaml").read_text(encoding="utf-8"))
APP_MAP = ROOT / "app-map" / "app-map.yaml"

# Rules switched off in config/profile.yaml are not checked (ids in config/features.yaml)
if not is_on("rule-step-comments"):
    RULES["required"]["every_excel_step_has_a_comment"] = False
if not is_on("rule-screenshot-every-step"):
    RULES["required"]["screenshot_after_every_step"] = False
if not is_on("rule-proves-nothing"):
    RULES["proves_nothing"] = {}
if not is_on("rule-checks-on-app-map"):
    RULES["expected_results"]["must_use_app_map"] = False
if not is_on("rule-quoted-values"):
    RULES["expected_results"]["quoted_values_must_appear"] = False
if not is_on("assertion-lock"):
    RULES["after_repair"]["assertion_lock"] = False
if not is_on("login-at-run-time"):
    RULES["required"]["login_matches_excel"] = False

STEP_COMMENT = re.compile(r"^\s*//\s*(\d+)\.\s+(.*?)\s*$")
GETBY = re.compile(r"getBy(Role|Label|Text|TestId|Placeholder|AltText|Title)\(\s*(['\"`])(.*?)\2\s*(?:,\s*\{([^}]*)\})?\s*\)")
NAME_OPT = re.compile(r"name\s*:\s*(?:(['\"`])(.*?)\1|/(.*?)/[a-z]*)")
# Power Apps canvas controls: canvas.control('Name'), canvas.input('Name'), canvas.galleryItems('Name')
# (tests/canvas.ts), or a raw [data-control-name="Name"] selector
CONTROL = re.compile(r"\.(control|input|galleryItems)\(\s*(['\"`])(.*?)\2\s*\)|data-control-name=\\?[\"'](.*?)\\?[\"']")
VISIBILITY = {"toBeVisible", "toBeAttached", "toBeEnabled", "toBeInViewport"}
# Double quotes of any kind, or single quotes that are not an apostrophe inside a word (the user's name)
QUOTED = re.compile(r"[\"“”](.+?)[\"“”]|(?<!\w)['‘](.+?)['’](?!\w)")
MONEY = re.compile(r"[€$£]\s?\d[\d.,]*\d|\d+[.,]\d+")
LOGIN_USE = re.compile(r"test\.use\(\s*\{[^}]*\bloginAs\s*:\s*(['\"`])([^'\"`]*)\1")
GOTO = re.compile(r"\.goto\(\s*(['\"`])(.*?)\1")
LINE_COMMENT = re.compile(r"^\s*//.*$", re.M)


def loose(s):
    return re.sub(r"[^a-z0-9€$£.,]+", " ", s.lower()).strip()


def quoted_values(text):
    return [a or b for a, b in QUOTED.findall(text)]


def matching(text, start):
    """Index just after the bracket that closes text[start] ('('), skipping strings."""
    depth, i, quote = 0, start, None
    while i < len(text):
        c = text[i]
        if quote:
            if c == "\\":
                i += 1
            elif c == quote:
                quote = None
        elif c in "'\"`":
            quote = c
        elif c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return len(text)


def expects(code):
    """Every expect(...).matcher(...) in a piece of code."""
    found = []
    for m in re.finditer(r"\bexpect(?:\.soft)?\(", code):
        arg_end = matching(code, m.end() - 1)
        arg = code[m.end():arg_end - 1].strip()
        rest = code[arg_end:]
        mm = re.match(r"\s*(\.not)?\s*\.(\w+)\(", rest)
        if not mm:
            continue
        call_start = arg_end + mm.end() - 1
        call_end = matching(code, call_start)
        found.append({"arg": arg, "matcher": mm.group(2), "negated": bool(mm.group(1)),
                      "args": code[call_start + 1:call_end - 1].strip(),
                      "raw": re.sub(r"\s+", " ", code[m.start():call_end])})
    return found


def variables_of(code):
    return dict(re.findall(r"(?:const|let|var)\s+(\w+)\s*=\s*([^;\n]+)", code))


def resolve(expr, variables):
    """Replace a leading variable by its definition, a few levels deep: const a = page...; const b = a.getBy..."""
    for _ in range(5):
        head = re.match(r"^(\w+)\b", expr)
        if head and head.group(1) in variables and variables[head.group(1)].strip() != expr:
            expr = variables[head.group(1)].strip() + expr[len(head.group(1)):]
        else:
            break
    return re.sub(r"\s+", " ", expr)


def locator_parts(expr, variables):
    """getBy* parts of a locator expression, resolving simple variables."""
    expr = resolve(expr, variables)
    parts = []
    for m in GETBY.finditer(expr):
        kind, value, opts = m.group(1), m.group(3), m.group(4) or ""
        name = NAME_OPT.search(opts)
        parts.append({"kind": kind, "value": value,
                      "name": (name.group(2) if name and name.group(2) is not None else None),
                      "name_regex": (name.group(3) if name and name.group(3) else None)})
    for m in CONTROL.finditer(expr):
        parts.append({"kind": "Control", "value": m.group(3) if m.group(3) is not None else m.group(4),
                      "helper": m.group(1) or "selector", "name": None, "name_regex": None})
    return parts, expr


def lock_signature(code):
    """What a test checks, with locator variables resolved, so that a repair cannot change a check by
    redefining the variable an expect(...) uses, or by wrapping the expect (decision 33)."""
    variables = variables_of(code)
    return sorted(f"{resolve(e['arg'], variables)} | {'not ' if e['negated'] else ''}{e['matcher']} | {re.sub(r'\\s+', ' ', e['args'])}"
                  for e in expects(code))


class AppMap:
    def __init__(self, data):
        self.elements = [e for p in (data or {}).get("pages", {}).values() for e in (p.get("elements") or [])]
        self.addresses = [p.get("address", "") for p in (data or {}).get("pages", {}).values()]

    def knows(self, part):
        kind, value = part["kind"], part["value"]
        for e in self.elements:
            role, name = e.get("role"), str(e.get("name", ""))
            if kind == "Role" and role == value:
                if part["name"] is not None and part["name"] == name:
                    return True
                if part["name_regex"] and re.search(part["name_regex"], name):
                    return True
                if part["name"] is None and not part["name_regex"]:
                    return True
            if kind in ("Label", "Placeholder", "Title", "AltText") and value == name:
                return True
            if kind == "Text" and value in (name, str(e.get("example_text", ""))):
                return True
            if kind == "TestId" and value == str(e.get("test_id", "")):
                return True
            if kind == "Control" and value == str(e.get("control_name", "")):
                return True
        return False

    def control_type(self, name):
        return next((str(e.get("control_type", "")) for e in self.elements if str(e.get("control_name", "")) == name), "")


def proves_nothing(exp, parts, clicked, rules, app_map=None):
    if rules.get("constant") and re.fullmatch(r"(true|false|\d+(\.\d+)?|(['\"`]).*\3)", exp["arg"]):
        return "always true: checks a constant"
    if rules.get("title_only") and exp["matcher"] == "toHaveTitle":
        return "always true: checks the page title only"
    if exp["negated"] or exp["matcher"] not in VISIBILITY:
        return None
    if rules.get("just_clicked_visible") and exp["arg"] in clicked:
        return "always true: checks that the element just clicked is visible"
    last = parts[-1] if parts else None
    if last and last["kind"] == "Role" and last["value"] in rules.get("container_exists", []):
        return f"always true: only checks that a {last['value']} exists, not what it contains"
    if last and last["kind"] == "Control":
        ctype = app_map.control_type(last["value"]).lower() if app_map else ""
        if ctype in rules.get("canvas_container_types", []) or last.get("helper") == "galleryItems":
            return f"always true: only checks that the canvas {ctype or 'gallery'} {last['value']} exists, not what it shows"
    return None


def check_file(path, case, app_map, rules, before=None):
    code = path.read_text(encoding="utf-8")
    code_no_comments = LINE_COMMENT.sub("", code)
    req, problems = rules["required"], []
    variables = variables_of(code)

    fixture = re.search(r"""import\s*\{[^}]*\btest\b[^}]*\}\s*from\s*['"](?:\.\./)+(fixtures|canvas-fixtures)['"]""", code)
    if req.get("uses_uat_fixture") and not fixture:
        problems.append("does not import test from tests/fixtures.ts or tests/canvas-fixtures.ts "
                        "(no console capture, no step screenshots, no login)")
    # Power Apps canvas apps (testing-canvas-apps skill): controls live in the player frame, and only keyboard
    # typing fires Power Fx OnChange, so fill() and pressSequentially() would leave the app unaware of the text
    canvas_rules = rules.get("canvas") or {}
    if canvas_rules and ((fixture and fixture.group(1) == "canvas-fixtures") or "fullscreen-app-host" in code_no_comments):
        for bad, why in (canvas_rules.get("forbidden") or {}).items():
            if bad in code_no_comments:
                problems.append(f"canvas app: '{bad}' is not allowed ({why})")
        if re.search(r"\bpage\.locator\(\s*['\"`][^'\"`]*data-control-name", code_no_comments):
            problems.append("canvas app: controls live inside the canvas frame; use canvas.control('Name'), not page.locator(...)")
    title = re.search(r"(?<![.\w])test\(\s*(['\"`])(.+?)\1", code)
    if req.get("mentions_test_id") and (not title or title.group(2).split(" ")[0] != case["test_id"]):
        problems.append(f"the test title must start with the Test ID {case['test_id']}")
    for bad in rules.get("forbidden", []):
        if bad in code_no_comments:
            problems.append(f"contains forbidden '{bad}'")

    # Login: the test must log in as exactly the account the Excel names, through the fixture
    if req.get("login_matches_excel"):
        wanted = account_key(case.get("login_as")) if case.get("login_as") else ""
        found = LOGIN_USE.search(code)
        got = found.group(2) if found else ""
        if wanted and got != wanted:
            problems.append(f"the Excel says Login as '{case['login_as']}': the test needs test.use({{ loginAs: '{wanted}' }})"
                            + (f", not '{got}'" if got else ""))
        if not wanted and got:
            problems.append(f"the Excel names no account, but the test logs in as '{got}'")
        if re.search(r"_PASSWORD|password\s*[:=]\s*['\"`]", code_no_comments, re.I):
            problems.append("a password or a password variable appears in the test; login belongs to tests/login.ts only")

    # The browser may only be sent to the test site (config/guardrails.yaml)
    if req.get("goto_only_allowed_origins"):
        allowed = allowed_origins()
        for _, url in GOTO.findall(code_no_comments):
            p = urlparse(url)
            if p.scheme and not origin_allowed(url, allowed):
                problems.append(f"goto('{url}') leaves the allowed sites ({', '.join(allowed)})")

    # Split the code into blocks, one per Excel step comment ("// 3. Click ...")
    blocks, comments, current = {0: []}, {}, 0
    for line in code.splitlines():
        m = STEP_COMMENT.match(line)
        if m:
            current = int(m.group(1))
            comments.setdefault(current, m.group(2))
            blocks.setdefault(current, [])
        blocks[current].append(line)
    blocks = {n: "\n".join(lines) for n, lines in blocks.items()}

    all_expects = expects(code)
    if req.get("at_least_one_check") and not all_expects:
        problems.append("has no check (expect) at all")

    for step in case["steps"]:
        n = step["n"]
        if req.get("every_excel_step_has_a_comment"):
            said = comments.get(n)
            if said is None:
                problems.append(f"step {n} has no '// {n}. ...' comment, so it may have been skipped")
            elif difflib.SequenceMatcher(None, loose(said), loose(step["text"])).ratio() < req.get("step_comment_similarity", 0.8):
                problems.append(f"step {n} comment does not match the Excel text ('{said}' vs '{step['text']}')")
        if req.get("screenshot_after_every_step") and not re.search(rf"\bshot\(\s*{n}\s*\)", blocks.get(n, "")):
            problems.append(f"step {n} has no 'await shot({n})'")

    er_rules, results = rules["expected_results"], []
    for er in case["expected_results"]:
        block = blocks.get(er["step"], "")
        clicked = set(re.findall(r"([\w.]+(?:\([^;\n]*?\))*)\.click\(", block))
        real, issue = [], None
        for exp in expects(block):
            parts, _ = locator_parts(exp["arg"], variables)
            why = proves_nothing(exp, parts, clicked, rules["proves_nothing"], app_map)
            if why:
                problems.append(f"step {er['step']}: {exp['raw'][:80]} -> {why}")
            else:
                real.append((exp, parts))
        if er_rules.get("must_have_check_in_step") and not real:
            issue = "no real check in this step's block"
        elif er_rules.get("must_use_app_map"):
            mapped = [(e, p) for e, p in real
                      if (e["arg"] == "page" and e["matcher"] == "toHaveURL") or any(app_map.knows(x) for x in p)]
            if app_map is None or not mapped:
                issue = "no check on an element recorded in app-map/app-map.yaml" if app_map else "app-map/app-map.yaml not found"
            real = mapped or real
        if not issue and er_rules.get("quoted_values_must_appear"):
            values = quoted_values(er["text"]) + MONEY.findall(QUOTED.sub("", er["text"]))
            missing = [v for v in values if not any(v in e["raw"] for e, _ in real)]
            if missing:
                issue = f"the check does not contain {', '.join(repr(v) for v in missing)}"
        if issue:
            problems.append(f"expected result '{er['step']}. {er['text']}': {issue}")
        results.append({"step": er["step"], "text": er["text"], "ok": issue is None, "problem": issue})

    if before is not None and rules["after_repair"].get("assertion_lock", True):
        old, new = lock_signature(before), lock_signature(code)
        if old != new:
            removed = [e for e in old if e not in new]
            added = [e for e in new if e not in old]
            problems.append("assertion lock: the repair changed what the test checks (expect lines or the locators they use)"
                            + (f"; removed {removed}" if removed else "") + (f"; added {added}" if added else ""))

    return {"test_id": case["test_id"], "ok": not problems, "problems": problems, "expected_results": results}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("run")
    parser.add_argument("--files", nargs="+")
    parser.add_argument("--assertion-lock", action="store_true")
    parser.add_argument("--snapshot", metavar="TEST_ID")
    parser.add_argument("--restore", metavar="TEST_ID")
    args = parser.parse_args()
    run = Path(args.run) if Path(args.run).is_absolute() else ROOT / args.run
    cases = {c["test_id"]: c for c in json.loads((run / "cases.json").read_text(encoding="utf-8"))}

    if args.snapshot:
        src = test_file_of(args.snapshot)
        if not src:
            print(f"No test file for {args.snapshot}")
            return 2
        dst = run / "tests-before" / src.name
        dst.parent.mkdir(exist_ok=True)
        shutil.copyfile(src, dst)
        print(f"Kept a copy of {src.relative_to(ROOT).as_posix()} for the assertion lock")
        return 0

    if args.restore:
        dst = test_file_of(args.restore)
        copy = run / "tests-before" / dst.name if dst else None
        if not copy or not copy.exists():
            print(f"No kept copy for {args.restore}")
            return 2
        shutil.copyfile(copy, dst)
        print(f"Restored {dst.relative_to(ROOT).as_posix()} from the copy made before the repair")
        return 0

    if args.files:
        targets = [ROOT / f for f in args.files]
    else:
        targets = [f for f in (test_file_of(t) for t, c in cases.items() if not is_manual(c)) if f]
    app_map = AppMap(yaml.safe_load(APP_MAP.read_text(encoding="utf-8"))) if APP_MAP.exists() else None

    report_file = run / "test-check.json"
    report = json.loads(report_file.read_text(encoding="utf-8")) if report_file.exists() else {"files": {}}
    rejected = 0
    for path in targets:
        rel = path.relative_to(ROOT).as_posix()
        if "_removed" in path.parts:
            print(f"REJECT  {rel}: set aside in tests/_removed/, never checked or run")
            rejected += 1
            continue
        tid = next((t for t in cases if path.name.startswith(t + "-")), path.stem)
        if tid not in cases:
            print(f"REJECT  {rel}: no case {tid} in cases.json")
            rejected += 1
            continue
        before = None
        if args.assertion_lock:
            copy = run / "tests-before" / path.name
            if not copy.exists():
                print(f"REJECT  {rel}: no copy in tests-before/ (run --snapshot {tid} before the repair)")
                rejected += 1
                continue
            before = copy.read_text(encoding="utf-8")
        result = check_file(path, cases[tid], app_map, RULES, before)
        result["checked_at"] = datetime.now().isoformat(timespec="seconds")
        report["files"][rel] = result
        if result["ok"]:
            print(f"ACCEPT  {rel}")
        else:
            rejected += 1
            print(f"REJECT  {rel}")
            for p in result["problems"]:
                print(f"          - {p}")
    report_file.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"{len(targets) - rejected} accepted, {rejected} rejected -> runs/{run.name}/test-check.json")
    return 1 if rejected else 0


if __name__ == "__main__":
    sys.exit(main())
