import { expect, test } from "vitest";
import { testBao } from "./helpers.js";

test("the API needs a signed-in person and the app header", async () => {
  const { app } = testBao();
  expect((await app.http.request("/api/me")).status).toBe(401);
  expect((await app.http.request("/api/days/2026-10-21")).status).toBe(401);
  const bare = await app.http.request("/api/entries", { method: "POST", body: "{}" });
  expect(bare.status).toBe(403);
});

test("log a day, and set targets", async () => {
  const bao = testBao();
  const alice = await bao.as("Alice");
  const me = await alice.get("/api/me");
  expect(me).toMatchObject({ name: "Alice", timezone: "Asia/Singapore", reminder_time: "21:00" });
  expect(me.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  const laksa = (await alice.get("/api/foods/search?q=laksa")).results[0];
  expect(laksa).toMatchObject({ name: "Laksa", source_label: "SG FoodID", editable: false });
  const made = await alice.req("POST", "/api/entries", { date: "2026-10-21", meal: "lunch", food_id: laksa.id });
  expect(made.status).toBe(200);
  const entry = await made.json();
  expect(entry).toMatchObject({ name: "Laksa", portion: "1 × bowl (604 g)", origin: "manual" });

  const day = await alice.get("/api/days/2026-10-21");
  expect(day.meals.lunch[0].name).toBe("Laksa");
  expect(day.meals.breakfast).toEqual([]);
  expect(day.totals.kcal).toBeGreaterThan(400);
  expect(day.meal_totals.lunch.kcal).toBe(day.totals.kcal);

  const patched = await (await alice.req("PATCH", `/api/entries/${entry.id}`, { servings: 0.5 })).json();
  expect(patched.grams).toBe(302);

  const updated = await (await alice.req("PATCH", "/api/me", { targets: { kcal: 1800, protein_g: 120 }, name: " Ali " })).json();
  expect(updated).toMatchObject({ name: "Ali", targets: { kcal: 1800, protein_g: 120 } });
  expect((await alice.get("/api/me")).targets.kcal).toBe(1800);
  expect((await alice.get("/api/history?start=2026-10-20&end=2026-10-21")).days.map((d: any) => d.entries)).toEqual([0, 1]);

  // people don't see each other's logs
  const bob = await bao.as("Bob");
  const theirs = await bob.get("/api/days/2026-10-21");
  expect(Object.values(theirs.meals).flat()).toEqual([]);
  expect((await bob.req("DELETE", `/api/entries/${entry.id}`)).status).toBe(404);
  expect((await alice.req("DELETE", `/api/entries/${entry.id}`)).status).toBe(200);
});

test("bad requests say what is wrong", async () => {
  const alice = await testBao().as("Alice");
  const cases: [string, string, unknown, number][] = [
    ["GET", "/api/days/nope", undefined, 400],
    ["GET", "/api/history?start=2020-01-01&end=2026-01-01", undefined, 400],
    ["POST", "/api/entries", { date: "2026-10-21", meal: "brunch", name: "x" }, 422],
    ["POST", "/api/entries", { date: "2026-10-21", meal: "lunch", name: "x" }, 400],
    ["POST", "/api/entries", { date: "2026-10-21", meal: "lunch", food_id: 999999 }, 400],
    ["PATCH", "/api/entries/999999", { servings: 2 }, 400],
    ["GET", "/api/foods/999999", undefined, 404],
    ["PATCH", "/api/me", { reminder_time: "7:30" }, 400],
    ["PATCH", "/api/me", { targets: { kcal: -5 } }, 400],
    ["DELETE", "/api/pins/999999", undefined, 404],
  ];
  for (const [method, url, body, status] of cases) {
    const res = await alice.req(method, url, body);
    expect([method, url, res.status]).toEqual([method, url, status]);
    expect(typeof (await res.json()).detail).toBe("string");
  }
});

test("household foods: create per serving, edit, delete", async () => {
  const alice = await testBao().as("Alice");
  const res = await alice.req("POST", "/api/foods", {
    name: "Test Granola", basis: "per_serving", serving_grams: 40,
    nutrients: { kcal: 180, protein_g: 4, carb_g: 28, fat_g: 6 },
    servings: [{ label: "scoop", grams: 40 }], aliases: ["granola"],
  });
  expect(res.status).toBe(200);
  const food = await res.json();
  expect(food).toMatchObject({ per_100g: { kcal: 450, protein_g: 10 }, editable: true, aliases: ["granola"] });
  expect((await alice.get("/api/foods/ours")).foods[0].name).toBe("Test Granola");
  const edited = await (await alice.req("PATCH", `/api/foods/${food.id}`, { brand: "Oatly" })).json();
  expect([edited.brand, edited.per_100g.kcal, edited.servings.length]).toEqual(["Oatly", 450, 1]);
  expect((await alice.req("DELETE", `/api/foods/${food.id}`)).status).toBe(200);
  expect((await alice.get("/api/foods/ours")).foods).toEqual([]);
  expect((await alice.get(`/api/foods/${food.id}`)).name).toBe("Test Granola");
  const laksa = (await alice.get("/api/foods/search?q=laksa")).results[0];
  expect((await alice.req("PATCH", `/api/foods/${laksa.id}`, { name: "x" })).status).toBe(400);
});

test("quick adds: pins, saved meals, copying yesterday", async () => {
  const alice = await testBao().as("Alice");
  const kopi = (await alice.get("/api/foods/search?q=kopi%20c")).results[0];
  const pin = await alice.post("/api/pins", { food_id: kopi.id });
  let quick = await alice.get("/api/quick?meal=breakfast&day=2026-10-21");
  expect(quick.pins[0]).toMatchObject({ food_id: kopi.id, kcal: 107.5, serving_label: "cup" });

  const first = await alice.post("/api/entries", { date: "2026-10-20", meal: "breakfast", food_id: kopi.id });
  const custom = await alice.post("/api/entries", { date: "2026-10-20", meal: "breakfast", name: "Bun", nutrients: { kcal: 200 } });
  const saved = await alice.post("/api/saved-meals", { name: " Usual ", entry_ids: [first.id, custom.id] });
  expect(saved).toMatchObject({ name: "Usual", items: [{ food_id: kopi.id, serving_label: "cup" }] });
  expect((await alice.req("POST", "/api/saved-meals", { name: "Empty", entry_ids: [custom.id] })).status).toBe(400);

  const logged = await alice.post(`/api/saved-meals/${saved.id}/log`, { date: "2026-10-21", meal: "breakfast" });
  expect(logged.entries.map((e: any) => [e.name, e.origin])).toEqual([["Kopi C", "quick"]]);
  const copied = await alice.post("/api/entries/copy", { entry_ids: [first.id, custom.id], date: "2026-10-21", meal: "snacks" });
  expect(copied.entries.map((e: any) => e.meal)).toEqual(["snacks", "snacks"]);

  quick = await alice.get("/api/quick?meal=breakfast&day=2026-10-21");
  expect(quick.yesterday.items.map((i: any) => i.name)).toEqual(["Kopi C", "Bun"]);
  expect(quick.saved_meals.map((m: any) => m.name)).toEqual(["Usual"]);
  expect((await alice.req("DELETE", `/api/pins/${pin.id}`)).status).toBe(200);
  expect((await alice.req("DELETE", `/api/saved-meals/${saved.id}`)).status).toBe(200);
});

test("usage and about", async () => {
  const alice = await testBao().as("Alice");
  expect(await alice.get("/api/usage")).toEqual({ month_usd: 0, turns: 0, model: "claude-haiku-5-5" });
  expect(await alice.get("/api/about")).toEqual({ version: "9.9.9", reference: {} });
});
