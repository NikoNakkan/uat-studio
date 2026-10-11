"""GitHub Copilot as the AI provider: the setting, the readiness it gives, and how models are named there."""
from app.copilot_llm import copilot_model


def test_studio_model_ids_map_to_copilot_names():
    assert copilot_model("claude-sonnet-5-5") == "claude-sonnet-5.5"
    assert copilot_model("claude-fable-5-1") == "claude-fable-5.1"
    assert copilot_model("gpt-5") == "gpt-5"


def test_choosing_copilot_makes_the_ai_ready_without_a_key(client):
    before = client.get("/api/settings").json()
    assert before["provider"] == "anthropic"
    r = client.put("/api/settings", json={"provider": "copilot"}).json()
    assert r["provider"] == "copilot" and r["ai_ready"] is True
    assert client.put("/api/settings", json={"provider": "openai"}).status_code == 422
    client.put("/api/settings", json={"provider": "anthropic"})
    assert client.get("/api/settings").json()["ai_ready"] == before["ai_ready"]


def test_a_github_token_is_kept_secret_and_classic_tokens_are_refused(client):
    r = client.put("/api/settings", json={"github_token": "ghp_classic000000000000000000000000000000"})
    assert r.status_code == 400 and "classic" in r.json()["detail"]
    assert client.put("/api/settings", json={"github_token": "hello"}).status_code == 400
    r = client.put("/api/settings", json={"github_token": "github_pat_11ABCDEFG0123456789_abcdWXYZ"}).json()
    assert r["github_token_set"] and r["github_token_hint"] == "…WXYZ"
    assert "github_pat_" not in str(client.get("/api/settings").json())          # never sent back
    assert not client.put("/api/settings", json={"clear_github_token": True}).json()["github_token_set"]
