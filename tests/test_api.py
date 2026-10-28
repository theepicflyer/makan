def test_requires_login(client):
    client.post("/api/auth/logout")
    assert client.get("/api/me").status_code == 401


def test_requires_app_header(logged_in):
    r = logged_in.post("/api/entries", json={}, headers={"x-makan": ""})
    assert r.status_code == 403


def test_log_a_day(logged_in):
    me = logged_in.get("/api/me").json()
    assert me["name"] == "Alice"
    laksa = logged_in.get("/api/foods/search", params={"q": "laksa"}).json()["results"][0]
    r = logged_in.post(
        "/api/entries", json={"date": "2026-10-21", "meal": "lunch", "food_id": laksa["id"]}
    )
    assert r.status_code == 200, r.text
    day = logged_in.get("/api/days/2026-10-21").json()
    assert day["meals"]["lunch"][0]["name"] == "Laksa"
    assert day["totals"]["kcal"] > 400
    logged_in.patch("/api/me", json={"targets": {"kcal": 1800, "protein_g": 120}})
    assert logged_in.get("/api/me").json()["targets"]["kcal"] == 1800


def test_users_do_not_see_each_other(client):
    client.post("/api/auth/dev-login", json={"name": "Bob"})
    day = client.get("/api/days/2026-10-21").json()
    assert all(not items for items in day["meals"].values())
    client.post("/api/auth/logout")


def test_household_food_crud(logged_in):
    r = logged_in.post(
        "/api/foods",
        json={
            "name": "Test Granola",
            "basis": "per_serving",
            "serving_grams": 40,
            "nutrients": {"kcal": 180, "protein_g": 4, "carb_g": 28, "fat_g": 6},
            "servings": [{"label": "scoop", "grams": 40}],
            "aliases": ["granola"],
        },
    )
    assert r.status_code == 200, r.text
    food = r.json()
    assert food["per_100g"]["kcal"] == 450
    assert logged_in.get("/api/foods/ours").json()["foods"][0]["name"] == "Test Granola"
    assert logged_in.delete(f"/api/foods/{food['id']}").status_code == 200


def test_mcp_endpoint_lists_tools(client):
    r = client.post(
        "/mcp",
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "t", "version": "0"},
            },
        },
        headers={
            "accept": "application/json, text/event-stream",
            "content-type": "application/json",
        },
    )
    assert r.status_code == 200, r.text


def test_usage_and_about(logged_in):
    usage = logged_in.get("/api/usage")
    assert usage.status_code == 200, usage.text
    assert usage.json()["month_usd"] >= 0
    assert logged_in.get("/api/about").status_code == 200


def test_quick_and_pins(logged_in):
    kopi = logged_in.get("/api/foods/search", params={"q": "kopi c"}).json()["results"][0]
    pin = logged_in.post("/api/pins", json={"food_id": kopi["id"]})
    assert pin.status_code == 200, pin.text
    quick = logged_in.get("/api/quick", params={"meal": "breakfast", "day": "2026-10-21"}).json()
    assert quick["pins"][0]["food_id"] == kopi["id"]
    assert logged_in.delete(f"/api/pins/{pin.json()['id']}").status_code == 200


def test_session_secret_is_generated_and_kept(tmp_path):
    from makan.config import Settings

    settings = Settings(data_dir=tmp_path, session_secret="")
    first = settings.resolved_session_secret()
    assert len(first) == 64
    assert Settings(data_dir=tmp_path, session_secret="").resolved_session_secret() == first
    assert (
        Settings(data_dir=tmp_path, session_secret="explicit").resolved_session_secret()
        == "explicit"
    )


def test_dcr_redirect_uris_default_and_override(tmp_path):
    from makan.config import Settings

    default = Settings(data_dir=tmp_path).dcr_redirect_uris
    assert "https://claude.ai/api/mcp/auth_callback" in default
    assert "https://agent.meta.ai/api/hatch/oauth/callback" in default
    custom = Settings(
        data_dir=tmp_path,
        mcp_dcr_allowed_redirect_uris="https://a.example.com/cb  http://localhost:*",
    )
    assert custom.dcr_redirect_uris == ["https://a.example.com/cb", "http://localhost:*"]
