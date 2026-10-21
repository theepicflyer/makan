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
    r = logged_in.post("/api/entries", json={"date": "2026-10-21", "meal": "lunch", "food_id": laksa["id"]})
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
    r = logged_in.post("/api/foods", json={
        "name": "Test Granola", "basis": "per_serving", "serving_grams": 40,
        "nutrients": {"kcal": 180, "protein_g": 4, "carb_g": 28, "fat_g": 6},
        "servings": [{"label": "scoop", "grams": 40}], "aliases": ["granola"],
    })
    assert r.status_code == 200, r.text
    food = r.json()
    assert food["per_100g"]["kcal"] == 450
    assert logged_in.get("/api/foods/ours").json()["foods"][0]["name"] == "Test Granola"
    assert logged_in.delete(f"/api/foods/{food['id']}").status_code == 200


def test_mcp_endpoint_lists_tools(client):
    r = client.post(
        "/mcp",
        json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
            "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "0"}}},
        headers={"accept": "application/json, text/event-stream", "content-type": "application/json"},
    )
    assert r.status_code == 200, r.text
