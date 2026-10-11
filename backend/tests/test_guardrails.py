"""Guardrails as settings: read, checked, written back so the kit's guard reads the same rules."""
import yaml


def test_the_kit_file_reads_as_settings(client):
    data = client.get("/api/guardrails").json()
    s = data["settings"]
    assert s["allowed_origins"] and "browser_evaluate" in s["blocked_tools"] and ".env" in s["protected_files"]
    assert "browser_evaluate" in data["known_tools"] and data["always_protected"] == ".env"


def test_saving_writes_a_file_the_guard_reads_and_keeps_env_protected(client, kit_dir):
    s = client.get("/api/guardrails").json()["settings"]
    body = {**s, "allowed_origins": ["http://localhost:4173/", "https://*.crm.dynamics.com"],
            "blocked_tools": ["browser_run_code"], "protected_files": ["secrets/keys.txt"],
            "never_click": ["Clear all", "Clear all"], "ask_before_click_matching": ["Delete", "archive"],
            "dialogs_need_approval": False}
    saved = client.put("/api/guardrails", json=body).json()
    assert saved["allowed_origins"] == ["http://localhost:4173", "https://*.crm.dynamics.com"]
    assert saved["protected_files"] == [".env", "secrets/keys.txt"]             # .env cannot be dropped
    assert saved["never_click"] == ["Clear all"] and saved["ask_before_click_matching"] == ["delete", "archive"]
    text = (kit_dir / "config" / "guardrails.yaml").read_text(encoding="utf-8")
    assert yaml.safe_load(text) == saved and text.startswith("# Read by scripts/guard_hook.py")
    client.put("/api/guardrails", json=s)                                        # leave the kit as it was


def test_nothing_is_saved_while_something_is_wrong(client, kit_dir):
    before = (kit_dir / "config" / "guardrails.yaml").read_text(encoding="utf-8")
    s = client.get("/api/guardrails").json()["settings"]
    for bad in ({"allowed_origins": []}, {"allowed_origins": ["localhost:4173"]}, {"blocked_tools": ["Run Code"]},
                {"protected_files": ["../outside.txt"]}):
        r = client.put("/api/guardrails", json={**s, **bad})
        assert r.status_code == 400, bad
    assert (kit_dir / "config" / "guardrails.yaml").read_text(encoding="utf-8") == before


def test_the_setup_box_changes_only_the_sites(client):
    s = client.get("/api/guardrails").json()["settings"]
    assert client.put("/api/guardrails/origins", json={"origins": ["https://test.example.com"]}).json() == ["https://test.example.com"]
    after = client.get("/api/guardrails").json()["settings"]
    assert {**after, "allowed_origins": s["allowed_origins"]} == s
    client.put("/api/guardrails", json=s)
