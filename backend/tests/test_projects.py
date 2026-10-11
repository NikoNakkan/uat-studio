"""Projects: each app under test in its own folder, chosen per request; nothing leaks between projects."""
import pytest

from app import projects


@pytest.fixture(scope="module")
def shop(client):
    """One project for this file, created once; its id is "shop" in a fresh state folder."""
    r = client.post("/api/projects", json={"name": "Shop", "start_page": "https://shop.test/start"})
    assert r.status_code == 200, r.text
    yield r.json()
    client.post("/api/projects/main/use")                    # leave the session's cookie on the main project


def H(pid):
    return {"X-UAT-Project": pid}


def test_main_project_is_listed_first(client):
    data = client.get("/api/projects").json()
    assert data["projects"][0]["id"] == "main"


def test_new_project_starts_blank_with_the_kit_code(client, kit_dir, shop):
    from pathlib import Path
    assert shop["current"] == "shop" and client.cookies.get("uat_project") == "shop"
    folder = Path(next(p["dir"] for p in shop["projects"] if p["id"] == "shop"))
    assert folder != kit_dir and (folder / "scripts" / "features.py").exists() and (folder / ".github" / "agents").exists()
    assert "write login() for your app" in (folder / "tests" / "login.ts").read_text(encoding="utf-8")
    assert "allowed_origins:\n  - https://shop.test\n" in (folder / "config" / "guardrails.yaml").read_text(encoding="utf-8")
    assert "START_PAGE=https://shop.test/start" in (folder / ".env").read_text(encoding="utf-8")
    assert not list((folder / "runs").glob("2*")) and not (folder / "app-map" / "app-map.yaml").exists()


def test_requests_see_only_their_project(client, kit_dir, shop):
    assert client.get("/api/env", headers=H("shop")).json()["start_page"] == "https://shop.test/start"
    assert client.get("/api/env", headers=H("main")).json()["start_page"] != "https://shop.test/start"
    with (kit_dir / "examples" / "expense-tracker-tests.xlsx").open("rb") as f:
        run_id = client.post("/api/runs", headers=H("main"), files={"file": ("e.xlsx", f)},
                             data={"strictness": "standard", "start": "false"}).json()["id"]
    assert any(r["id"] == run_id for r in client.get("/api/runs", headers=H("main")).json())
    assert all(r["id"] != run_id for r in client.get("/api/runs", headers=H("shop")).json())
    client.delete(f"/api/runs/{run_id}", headers=H("main"))


def test_feature_switches_are_per_project(client, shop):
    client.post("/api/features/switch", headers=H("shop"), json={"id": "step-screenshots", "action": "off", "apply": True})
    on = lambda pid: {i["id"]: i["on"] for i in client.get("/api/features", headers=H(pid)).json()["items"]}  # noqa: E731
    assert on("shop")["step-screenshots"] is False and on("main")["step-screenshots"] is True


def test_the_cookie_picks_the_project(client, shop):
    assert client.get("/api/health").json()["project"] == "shop"         # the cookie set when it was created
    client.post("/api/projects/main/use")
    assert client.get("/api/health").json()["project"] == "main"


def test_update_kit_files_copies_code_not_data(client, kit_dir, shop):
    from pathlib import Path
    folder = Path(next(p["dir"] for p in shop["projects"] if p["id"] == "shop"))
    (folder / ".env").write_text("START_PAGE=https://shop.test/kept\n", encoding="utf-8")
    marker = kit_dir / "scripts" / "new_helper.py"
    marker.write_text("# new in the main kit\n", encoding="utf-8")
    try:
        r = client.post("/api/projects/shop/sync").json()
        assert "scripts" in r["updated"] and (folder / "scripts" / "new_helper.py").exists()
        assert (folder / ".env").read_text(encoding="utf-8") == "START_PAGE=https://shop.test/kept\n"
    finally:
        marker.unlink()


def test_rename_and_bad_input(client, shop):
    names = [p["name"] for p in client.put("/api/projects/shop", json={"name": "Shop online"}).json()["projects"]]
    assert "Shop online" in names
    assert client.post("/api/projects", json={"name": "", "start_page": "https://x.test"}).status_code == 400
    assert client.post("/api/projects", json={"name": "X", "start_page": "not a url"}).status_code == 400
    assert client.post("/api/projects/nope/use").status_code == 404


def test_a_second_project_of_the_same_name_gets_its_own_id(client, shop):
    r = client.post("/api/projects", json={"name": "Shop", "start_page": "https://shop2.test"}).json()
    assert r["current"] == "shop-2" and projects.get("shop-2")


def test_savings_settings_are_per_project_and_start_at_4_hours(client, shop):
    rows = {p["id"]: p for p in client.get("/api/projects").json()["projects"]}
    assert rows[shop["current"]]["savings"] == {"hourly_rate": None, "manual_hours": 4.0}
    r = client.put(f"/api/projects/{shop['current']}/savings", json={"hourly_rate": 45, "manual_hours": 6.5})
    assert r.json() == {"hourly_rate": 45, "manual_hours": 6.5}
    rows = {p["id"]: p for p in client.get("/api/projects").json()["projects"]}
    assert rows[shop["current"]]["savings"]["manual_hours"] == 6.5
    assert rows["main"]["savings"]["hourly_rate"] is None                   # other projects keep their own
    assert client.put(f"/api/projects/{shop['current']}/savings", json={"hourly_rate": -1}).status_code == 422
    assert client.put("/api/projects/nope/savings", json={"hourly_rate": 1}).status_code == 404
