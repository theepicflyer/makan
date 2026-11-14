import { eq } from "drizzle-orm";
import { saveImage, schema as warren } from "warren/server";
import sharp from "sharp";
import { expect, test } from "vitest";
import { buildContext } from "../src/agent/context.js";
import { SYSTEM_PROMPT } from "../src/agent/systemPrompt.js";
import * as foodSvc from "../src/foods.js";
import * as logSvc from "../src/log.js";
import { entries } from "../src/schema.js";
import { FakeClaude, say, testBao, turn, use } from "./helpers.js";

const DAY = "2026-03-03";

test("a turn logs through the tools, and the next turn replays it byte for byte", async () => {
  const claude = new FakeClaude([
    use("tu_1", "log_entries", { entries: [{ meal: "breakfast", food_id: 0 }] }),
    say("Logged kopi C."),
    say("You had 108 kcal."),
  ]);
  const bao = testBao({ anthropic: claude });
  (claude as any).responses[0].content[0].input.entries[0].food_id = bao.foodId("Kopi C");
  const alice = await bao.as("Alice");

  const events = await turn(bao, alice, "kopi c for breakfast");
  const done = events.at(-1);
  expect(done.turn.reply_text).toBe("Logged kopi C.");
  expect(done.turn.changes).toEqual([{ table: "entries", action: "create", row_id: 1, name: "Kopi C", kcal: 107.5 }]);
  expect(events.find((e) => e.type === "changed")).toEqual({ type: "changed", touched: [DAY] });

  const first = claude.requests[0]!;
  expect(first.system).toEqual([{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }]);
  expect(first.tools.map((t: any) => t.name)).toEqual([
    "delete_entries", "delete_food", "get_entries", "log_entries", "save_food", "search_foods", "update_entries",
  ]);
  expect(first.messages[0].content.at(-1).text).toContain("<context>");
  // the tool result the model read
  expect(claude.requests[1]!.messages[2].content[0].content).toBe(
    `Logged ${DAY} #1 breakfast: Kopi C — 1 × cup (250 g) — 108 kcal, P3 C18 F3\nDay total ${DAY}: 108 kcal, P3 C18 F3`,
  );

  await turn(bao, alice, "how many calories?", { threadId: events[0].thread_id });
  const previous = claude.requests[1]!.messages;
  expect(JSON.stringify(claude.requests[2]!.messages.slice(0, previous.length))).toBe(JSON.stringify(previous));
  const stored = bao.db.select().from(warren.turns).all()[0]!;
  expect([stored.usage.cache_read, stored.costUsd > 0, stored.appVersion]).toEqual([200, true, "9.9.9"]);
  expect((await alice.get("/api/usage")).turns).toBe(2);
});

test("the search tool's schema keeps its guidance for the model", async () => {
  const claude = new FakeClaude([say("Hi.")]);
  const bao = testBao({ anthropic: claude });
  await turn(bao, await bao.as("Alice"), "hi");
  const tools = Object.fromEntries(claude.requests[0]!.tools.map((t: any) => [t.name, t]));
  expect(tools.search_foods.input_schema).toEqual({
    type: "object",
    properties: {
      queries: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 15, description: "One short food name per item." },
      limit: { type: "integer", minimum: 1, maximum: 10, default: 5, description: "Matches per query, default 5." },
    },
    required: ["queries", "limit"],
    additionalProperties: false,
  });
  const item = tools.log_entries.input_schema.properties.entries.items;
  expect(item.required).toEqual(["meal"]);
  expect(item.properties.meal.enum).toEqual(["breakfast", "lunch", "dinner", "snacks"]);
  expect(item.properties.grams.description).toContain("Total weight eaten");
  expect(item.additionalProperties).toBe(false);
});

test("each time Bao is opened is a new thread, kept to its person and day", async () => {
  const claude = new FakeClaude(Array.from({ length: 5 }, (_, i) => say(String(i))));
  const bao = testBao({ anthropic: claude });
  const alice = await bao.as("Alice");
  const first = (await turn(bao, alice, "hi"))[0].thread_id;
  expect((await turn(bao, alice, "and?", { threadId: first }))[0].thread_id).toBe(first);
  expect(claude.requests[1]!.messages).toHaveLength(3);
  const fresh = (await turn(bao, alice, "hello again"))[0].thread_id;
  expect(fresh).not.toBe(first);
  expect(claude.requests[2]!.messages).toHaveLength(1);
  const otherDay = (await turn(bao, alice, "x", { threadId: first, day: "2026-03-04" }))[0].thread_id;
  const otherUser = (await turn(bao, await bao.as("Bob"), "x", { threadId: first }))[0].thread_id;
  expect([first, fresh]).not.toContain(otherDay);
  expect([first, fresh]).not.toContain(otherUser);
});

test("household foods are sent once per thread, and again only when they change", async () => {
  const claude = new FakeClaude([
    say("a"), say("b"),
    use("tu_f", "save_food", { name: "Test Soy Milk", nutrients: { basis: "per_100g", kcal: 58 }, servings: [{ label: "glass", grams: 200, default: true }], aliases: ["test soy milk"] }),
    say("Saved."), say("d"),
  ]);
  const bao = testBao({ anthropic: claude });
  const alice = await bao.as("Alice");
  const context = (i: number) => claude.requests[i]!.messages.at(-1).content.at(-1).text as string;
  const thread = (await turn(bao, alice, "hi"))[0].thread_id;
  expect(context(0)).toContain("Household foods (Ours):\n- (none yet)");
  await turn(bao, alice, "again", { threadId: thread });
  expect(context(1)).not.toContain("Household foods");

  const saved = (await turn(bao, alice, "save this milk", { threadId: thread })).at(-1);
  expect(saved.turn.changes).toEqual([
    { table: "foods", action: "create", row_id: expect.any(Number), name: "Test Soy Milk", serving: "glass", kcal: 116, aliases: ["test soy milk"] },
  ]);
  await turn(bao, alice, "thanks", { threadId: thread });
  expect(context(4)).toContain("Household foods (Ours):\n- #");
  expect(context(4)).toContain("Test Soy Milk [Ours] 58 kcal/100g, P? C? F? · servings: glass=200g (116 kcal)* · aliases: test soy milk");
});

test("a batch keeps its good items and reports the bad ones", async () => {
  const claude = new FakeClaude([
    use("tu_3", "log_entries", { entries: [{ meal: "lunch", food_id: 999999 }, { meal: "lunch", name: "Teh", kcal: 80 }, { meal: "lunch", name: "No numbers" }] }),
    say("Logged the teh."),
    use("tu_4", "log_entries", { entries: [{ meal: "brunch" }] }),
    say("Sorry."),
  ]);
  const bao = testBao({ anthropic: claude });
  const alice = await bao.as("Alice");
  await turn(bao, alice, "lunch");
  const result = claude.requests[1]!.messages.at(-1).content[0];
  expect(result.is_error).toBeUndefined();
  expect(result.content.split("\n")).toEqual([
    `Logged ${DAY} #1 lunch: Teh (estimate) — portion n/a — 80 kcal, P? C? F?`,
    "Not logged — item 1: No food with id 999999",
    "Not logged — item 3: an item without a food_id needs kcal",
    `Day total ${DAY}: 80 kcal, P0 C0 F0`,
  ]);
  await turn(bao, alice, "brunch");
  const invalid = claude.requests[3]!.messages.at(-1).content[0];
  expect(invalid.is_error).toBe(true);
  expect(invalid.content).toContain("meal");
});

test("edits and deletes go through the tools, and the whole turn can be undone", async () => {
  const bao = testBao();
  const toast = bao.foodId("Kaya toast");
  const claude = new FakeClaude([
    use("tu_1", "log_entries", { entries: [{ meal: "snacks", food_id: toast, servings: 2, serving: "slice" }, { meal: "snacks", food_id: bao.foodId("Kopi C") }] }),
    use("tu_2", "update_entries", { updates: [{ entry_id: 1, servings: 3, date: "2026-03-02" }, { entry_id: 77, meal: "lunch" }] }),
    use("tu_3", "delete_entries", { entry_ids: [2, 78] }),
    use("tu_4", "get_entries", { date: "2026-03-02" }),
    use("tu_5", "search_foods", { queries: ["kaya toast", "zzz"] }),
    say("Done."),
  ]);
  const withAgent = testBao({ anthropic: claude });
  const alice = await withAgent.as("Alice");
  const events = await turn(withAgent, alice, "2 slices kaya toast and a kopi");
  const results = claude.requests.slice(1).map((r) => r.messages.at(-1).content[0].content as string);
  expect(results[1]).toContain("Updated 2026-03-02 #1 snacks: Kaya toast — 3 × slice (135 g) — 446 kcal");
  expect(results[1]).toContain("Not updated — #77: No entry with id 77");
  expect(results[2]!.split("\n").slice(0, 2)).toEqual(["Deleted #2 Kopi C", "Not deleted — No entry with id 78"]);
  expect(results[3]).toBe("Entries on 2026-03-02:\n#1 snacks: Kaya toast — 3 × slice (135 g) — 446 kcal, P8 C61 F19\nTotal: 446 kcal, P8 C61 F19");
  expect(results[4]).toContain('"kaya toast":\n  #');
  expect(results[4]).toContain('"zzz":\n  (no matches)');
  expect(events.at(-1).touched).toEqual(["2026-03-02", DAY]);
  expect(withAgent.db.select().from(entries).all().map((e) => [e.date, e.origin])).toEqual([["2026-03-02", "agent"]]);

  const undone = await alice.post(`/api/agent/turns/${events.at(-1).turn.id}/undo`);
  expect(undone.undone).toBe(true);
  expect(withAgent.db.select().from(entries).all()).toEqual([]);
});

test("several photos are numbered, and each item is linked to the one it came from", async () => {
  const bao0 = testBao();
  const claude = new FakeClaude([
    use("tu_4", "log_entries", { entries: [{ meal: "lunch", food_id: bao0.foodId("Laksa"), photo: 2 }, { meal: "lunch", name: "Teh", kcal: 80 }] }),
    say("Logged."),
  ]);
  const bao = testBao({ anthropic: claude });
  const alice = await bao.as("Alice");
  const user = bao.user("Alice");
  const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#888" } }).jpeg().toBuffer();
  const ids = [];
  for (let i = 0; i < 2; i++) ids.push((await saveImage(bao.db, bao.app.config.dataDir, { userId: user.id, data: jpeg })).id);
  const events = await turn(bao, alice, "lunch", { fileIds: ids });
  const content = claude.requests[0]!.messages.at(-1).content;
  expect(content.map((b: any) => b.type)).toEqual(["text", "image", "text", "image", "text"]);
  expect(content[2].text).toBe("Photo 2:");
  expect(events.at(-1).turn.file_ids).toEqual(ids);
  expect(bao.db.select().from(entries).all().map((e) => e.photo_id)).toEqual([ids[1], null]);
  expect((await alice.get("/api/days/2026-03-03")).meals.lunch[0].photo_id).toBe(ids[1]);
});

test("a rating never reaches the agent", async () => {
  const claude = new FakeClaude([say("Logged."), say("Sure.")]);
  const bao = testBao({ anthropic: claude });
  const alice = await bao.as("Alice");
  const first = await turn(bao, alice, "kopi c");
  const id = first.at(-1).turn.id;
  const url = `/api/agent/turns/${id}/rating`;
  const note = "zzz-rating-note-zzz";
  expect(await (await alice.req("PUT", url, { rating: -1, note: `  ${note} ` })).json()).toMatchObject({ rating: -1, rating_note: note });
  // thumbs down again without a note keeps the note; thumbs up drops it
  expect((await (await alice.req("PUT", url, { rating: -1 })).json()).rating_note).toBe(note);
  await turn(bao, alice, "and teh", { threadId: first[0].thread_id });
  const sent = JSON.stringify(claude.requests[1]);
  expect(sent).not.toContain(note);
  expect(sent).not.toContain("rating");
  expect((await (await alice.req("PUT", url, { rating: 1 })).json()).rating_note).toBeNull();
  expect((await alice.req("PUT", url, { rating: 2 })).status).toBe(400);
  expect((await (await bao.as("Bob")).req("PUT", url, { rating: 1 })).status).toBe(404);
  expect(bao.db.select().from(warren.turns).where(eq(warren.turns.id, id)).get()!.rating).toBe(1);
});

test("the context names today, yesterday and the log date", () => {
  const { db, user, foodId } = testBao();
  const alice = user("Alice");
  logSvc.addEntry(db, alice, { day: "2026-10-20", meal: "dinner", food_id: foodId("Laksa") });
  logSvc.addEntry(db, alice, { day: "2026-10-20", meal: "breakfast", food_id: foodId("Kopi C") });
  const at = (iso: string) =>
    buildContext(db, alice, { now: new Date(iso), timezone: "Asia/Singapore", logDate: "2026-10-20", includeFoods: false, includeFrequent: true });

  const text = at("2026-10-21T01:40:00Z"); // 09:40 in Singapore
  expect(text).toContain("Today: Wed 21 Oct 2026 (2026-10-21), 09:40 Singapore time.");
  expect(text).toContain("Yesterday: Tue 20 Oct 2026 (2026-10-20).");
  expect(text).toContain("showing): Tue 20 Oct 2026 (2026-10-20), yesterday.");
  expect(text).toContain("Entries on 2026-10-21 (today):\n- (nothing logged yet)");
  // meals in the order of the day, whatever order they were logged in
  expect(text).toContain(
    "Entries on 2026-10-20 (yesterday):\n- #2 breakfast: Kopi C — 1 × cup (250 g) — 108 kcal, P3 C18 F3\n- #1 dinner: Laksa — 1 × bowl (604 g) — 417 kcal, P20 C42 F18\n- Total: 524 kcal, P23 C59 F21",
  );
  expect(text).toContain("This user's frequent foods (food_id, usual portion):\n- #");
  expect(text).not.toContain("just after midnight");
  expect(text.startsWith("<context>\n") && text.endsWith("\n</context>")).toBe(true);

  // 00:40 on the 21st: "today" still means the 20th
  expect(at("2026-10-20T16:40:00Z")).toContain('"today" and "tonight" mean Tue 20 Oct 2026 (2026-10-20).');
  expect(foodSvc.oursFingerprint([])).toHaveLength(16);
});
