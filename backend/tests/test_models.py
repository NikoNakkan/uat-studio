from app.catalog import AGENTS, HAIKU, MODELS, OPUS, SONNET
from app.settings import Settings


def test_every_agent_recommends_an_offered_model():
    assert all(info.recommended in MODELS for info in AGENTS.values())


def test_recommended_model_is_the_default():
    s = Settings()
    assert s.model_for("uat-diagnostician") == OPUS
    assert s.model_for("uat-reporter") == HAIKU
    assert s.model_for("not-an-agent") == s.default_model


def test_only_real_choices_are_stored():
    s = Settings()
    s.choose_models({"uat-reporter": SONNET, "uat-clarifier": SONNET, "nobody": OPUS, "uat-diagnostician": "gpt-x"})
    assert s.models == {"uat-reporter": SONNET}     # same as recommended, unknown agent, unknown model: dropped


def test_a_model_no_longer_offered_falls_back_to_the_recommendation():
    assert Settings(models={"uat-reporter": "claude-haiku-4-5-20251001"}).model_for("uat-reporter") == HAIKU


def test_settings_api_shows_recommendations(client):
    r = client.put("/api/settings", json={"models": {"uat-reporter": SONNET, "uat-clarifier": SONNET}}).json()
    assert r["models"]["uat-reporter"] == SONNET and r["models"]["uat-diagnostician"] == OPUS
    assert r["agents"]["uat-reporter"]["recommended"] == HAIKU and r["agents"]["uat-reporter"]["why"]
    assert {m["id"] for m in r["model_choices"]} == set(MODELS)
    r = client.put("/api/settings", json={"models": {}}).json()
    assert r["models"]["uat-reporter"] == HAIKU
