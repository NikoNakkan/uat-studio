"""Record which model ran a stage and how many tokens it used (decision 32), or print the totals.

Usage:
  python usage_report.py --run runs/<run-id> --stage <stage-id> --agent <agent-name>
                         [--input-tokens N --output-tokens N]     (exact, e.g. from the Copilot debug log)
                         [--model ID]                              (overrides the agent file, e.g. from UAT Studio)
                         [--cache-read-tokens N --cache-write-tokens N]  (the part of the input served from or
                                                                          written to the prompt cache, so cost is exact)
                         [--sent FILE ...] [--received FILE ...]  (estimate: about 4 characters per token)
  python usage_report.py --run runs/<run-id> --summary

The model is read from .github/agents/<agent-name>.agent.md (its model: field), so it is exact.
Appends to runs/<run-id>/usage.json. Exit 0 = recorded, 1 = refused, 2 = usage error.
"""
import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[4]
CHARS_PER_TOKEN = 4


def model_of(agent):
    file = ROOT / ".github" / "agents" / f"{agent}.agent.md"
    if not file.exists():
        return None
    m = re.match(r"^---\s*\n(.*?)\n---", file.read_text(encoding="utf-8"), re.S)
    model = (yaml.safe_load(m.group(1)) or {}).get("model") if m else None
    if isinstance(model, list):                     # a prioritised list: the first one is used when available
        model = f"{model[0]} (first of {len(model)})"
    return model or "not set in the agent file"


def chars(files):
    return sum(len(Path(f).read_text(encoding="utf-8", errors="replace")) for f in files or [] if Path(f).exists())


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--run", required=True)
    parser.add_argument("--stage")
    parser.add_argument("--agent")
    parser.add_argument("--input-tokens", type=int)
    parser.add_argument("--output-tokens", type=int)
    parser.add_argument("--cache-read-tokens", type=int)
    parser.add_argument("--cache-write-tokens", type=int)
    parser.add_argument("--sent", nargs="*")
    parser.add_argument("--received", nargs="*")
    parser.add_argument("--summary", action="store_true")
    parser.add_argument("--model", help="the model that actually ran (a host such as UAT Studio knows it exactly)")
    args = parser.parse_args()
    run = Path(args.run) if Path(args.run).is_absolute() else ROOT / args.run
    file = run / "usage.json"
    usage = json.loads(file.read_text(encoding="utf-8")) if file.exists() else []

    if args.summary:
        totals = {}
        for u in usage:
            t = totals.setdefault(u["model"], {"input": 0, "output": 0, "estimated": False})
            t["input"] += u["input_tokens"]; t["output"] += u["output_tokens"]
            t["estimated"] |= u["source"] == "estimated"
        for model, t in totals.items():
            print(f"{model}: input {t['input']:,} output {t['output']:,}" + (" (partly estimated)" if t["estimated"] else ""))
        return 0

    if not (args.stage and args.agent):
        print("--stage and --agent are required.")
        return 2
    model = args.model or model_of(args.agent)
    if model is None:
        print(f"No agent file .github/agents/{args.agent}.agent.md")
        return 1
    if args.input_tokens is not None and args.output_tokens is not None:
        tin, tout, source = args.input_tokens, args.output_tokens, "exact"
    else:
        tin, tout, source = chars(args.sent) // CHARS_PER_TOKEN, chars(args.received) // CHARS_PER_TOKEN, "estimated"
    row = {"stage": args.stage, "agent": args.agent, "model": model, "input_tokens": tin, "output_tokens": tout,
           "source": source, "at": datetime.now().isoformat(timespec="seconds")}
    if args.cache_read_tokens is not None:
        row["cache_read_tokens"] = args.cache_read_tokens
        row["cache_write_tokens"] = args.cache_write_tokens or 0
    usage.append(row)
    file.write_text(json.dumps(usage, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"stage={args.stage} agent={args.agent} model={model} input={tin:,} output={tout:,} source={source}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
