from pytest import approx

from app.costs import price, summarise

SONNET, HAIKU = "claude-sonnet-5-5", "claude-haiku-5-5"


def test_cached_tokens_are_priced_at_their_own_rate():
    # Sonnet: $2 in, $10 out per million. 1M input of which 600k read from and 100k written to the cache.
    row = {"model": SONNET, "input_tokens": 1_000_000, "output_tokens": 100_000,
           "cache_read_tokens": 600_000, "cache_write_tokens": 100_000}
    assert price(row) == approx(0.3 * 2 + 0.6 * 2 * 0.1 + 0.1 * 2 * 1.25 + 0.1 * 10)


def test_older_rows_without_the_split_are_an_upper_bound():
    row = {"stage": "clarify", "agent": "uat-clarifier", "model": SONNET, "input_tokens": 1_000_000, "output_tokens": 0}
    s = summarise([row])
    assert s["total"] == approx(2.0) and s["estimated"]


def test_breakdown_by_stage_agent_and_model_biggest_first():
    rows = [
        {"stage": "generate", "agent": "playwright-test-generator", "model": SONNET, "input_tokens": 2_000_000,
         "output_tokens": 0, "cache_read_tokens": 0, "cache_write_tokens": 0},
        {"stage": "report", "agent": "uat-reporter", "model": f"{HAIKU} (first of 2)", "input_tokens": 1_000_000,
         "output_tokens": 0, "cache_read_tokens": 0, "cache_write_tokens": 0},
        {"stage": "report", "agent": "uat-reporter", "model": "some-old-model", "input_tokens": 5, "output_tokens": 5},
    ]
    s = summarise(rows)
    assert s["total"] == approx(4.1) and s["calls"] == 3
    assert [i["key"] for i in s["by_stage"]] == ["generate", "report"]
    assert s["by_stage"][1]["calls"] == 2
    assert [i["key"] for i in s["by_model"]][:2] == [SONNET, HAIKU]
    assert s["unpriced"] == ["some-old-model"]


def test_no_usage_costs_nothing():
    s = summarise([])
    assert s["total"] == 0 and not s["estimated"] and s["by_agent"] == []


def test_run_summary_and_detail_carry_the_cost(client, kit_dir):
    import json
    run = kit_dir / "runs" / "2026-01-01-0000"
    run.mkdir(parents=True)
    (run / "progress.json").write_text(json.dumps({"excel": "x.xlsx", "stages": {}}), encoding="utf-8")
    (run / "usage.json").write_text(json.dumps([{"stage": "clarify", "agent": "uat-clarifier", "model": SONNET,
                                                  "input_tokens": 500_000, "output_tokens": 0}]), encoding="utf-8")
    listed = next(r for r in client.get("/api/runs").json() if r["id"] == "2026-01-01-0000")
    assert listed["cost"] == approx(1.0)
    assert client.get("/api/runs/2026-01-01-0000").json()["cost"]["by_agent"][0]["key"] == "uat-clarifier"
    assert client.get("/api/runs/2026-01-01-0000/cost").json()["by_stage"][0]["key"] == "clarify"
    assert client.get("/api/runs/no-such-run/cost").status_code == 404


def test_a_stage_removed_from_the_flow_is_not_counted(client, kit_dir):
    import json

    from app import kit

    ids = [s["id"] for s in kit.workflow()["stages"]]
    run = kit_dir / "runs" / "2026-01-06-0000"
    run.mkdir(parents=True)
    stages = {s: {"status": "done"} for s in ids} | {"console_review": {"status": "skipped"}}
    (run / "progress.json").write_text(json.dumps({"stages": stages}), encoding="utf-8")
    listed = next(r for r in client.get("/api/runs").json() if r["id"] == "2026-01-06-0000")
    assert listed["stages_done"] == listed["stages_total"] == len(ids)              # was "12 of 11 stages"
