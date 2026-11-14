import { eq } from "drizzle-orm";
import { schema as warren, turnChanges, undoChanges } from "warren/server";
import { expect, test } from "vitest";
import * as foodSvc from "../src/foods.js";
import * as logSvc from "../src/log.js";
import { entry_edits } from "../src/schema.js";
import { testBao } from "./helpers.js";

const DAY = "2026-01-15";

test("add, change and delete an entry", () => {
  const { db, user, foodId } = testBao();
  const alice = user("Alice");
  let e = logSvc.addEntry(db, alice, { day: DAY, meal: "breakfast", food_id: foodId("Kaya toast"), servings: 2, serving: "slice" });
  expect([e.grams, e.kcal, e.is_estimate, e.origin]).toEqual([90, 297, false, "manual"]);
  // "make that 3" keeps the slice serving
  e = logSvc.updateEntry(db, alice, e.id, { servings: 3 });
  expect([e.serving_label, e.grams]).toEqual(["slice", 135]);
  e = logSvc.updateEntry(db, alice, e.id, { meal: "snacks" });
  expect(e.meal).toBe("snacks");
  // swapping the food recomputes from the new food's default serving
  e = logSvc.updateEntry(db, alice, e.id, { food_id: foodId("Laksa") });
  expect([e.name, e.grams, e.serving_label]).toEqual(["Laksa", 604, "bowl"]);
  logSvc.deleteEntry(db, alice, e.id);
  expect(logSvc.entriesBetween(db, alice, DAY, DAY)).toEqual([]);
  expect(() => logSvc.getEntry(db, user("Bob"), e.id)).toThrow("No entry");
});

test("a custom entry scales with its servings, and given numbers replace only themselves", () => {
  const { db, user } = testBao();
  const alice = user("Alice");
  let e = logSvc.addEntry(db, alice, {
    day: DAY, meal: "dinner", name: "Mee rebus", servings: 1,
    nutrients: { kcal: 550, protein_g: 20, carb_g: 70, fat_g: 18 },
  });
  expect(e.is_estimate).toBe(true);
  e = logSvc.updateEntry(db, alice, e.id, { servings: 0.5 });
  expect([e.kcal, e.protein_g]).toEqual([275, 10]);
  e = logSvc.updateEntry(db, alice, e.id, { nutrients: { protein_g: 14 } });
  expect([e.kcal, e.protein_g, e.carb_g]).toEqual([275, 14, 35]);
  expect(() => logSvc.addEntry(db, alice, { day: DAY, meal: "dinner", name: "x" })).toThrow("needs kcal");
  expect(() => logSvc.addEntry(db, alice, { day: DAY, meal: "dinner", nutrients: { kcal: 1 } })).toThrow("needs a name");
  expect(() => logSvc.addEntry(db, alice, { day: DAY, meal: "brunch", name: "x", nutrients: { kcal: 1 } })).toThrow("meal must be");
});

test("supper goes to snacks, and a brand is added to the name once", () => {
  const { db, user, foodId } = testBao();
  const alice = user("Alice");
  expect(logSvc.addEntry(db, alice, { day: DAY, meal: "supper", food_id: foodId("Kopi C") }).meal).toBe("snacks");
  const { food } = foodSvc.saveOurs(db, alice.id, { name: "Greek Light", brand: "Chobani", nutrients: { kcal: 55 } });
  expect(logSvc.addEntry(db, alice, { day: DAY, meal: "snacks", food_id: food.id }).name).toBe("Chobani Greek Light");
});

test("undo reverts a turn's entries and foods, and the search index follows", () => {
  const { db, user, foodId } = testBao();
  const alice = user("Alice");
  const thread = db.insert(warren.threads).values({ userId: alice.id, scope: DAY, model: "x" }).returning().get();
  const turn = db.insert(warren.turns).values({ threadId: thread.id }).returning().get();
  const keep = logSvc.addEntry(db, alice, { day: DAY, meal: "lunch", food_id: foodId("Laksa") });
  const yogurt = foodSvc.saveOurs(db, alice.id, { name: "Yogurt A", nutrients: { kcal: 60 }, aliases: ["yogurt"] }).food;

  const changes = turnChanges(db, turn.id);
  const added = logSvc.addEntry(db, alice, { day: DAY, meal: "breakfast", food_id: foodId("Kopi C") }, changes);
  logSvc.updateEntry(db, alice, keep.id, { servings: 0.5 }, { changes });
  logSvc.deleteEntry(db, alice, keep.id, { changes });
  const made = foodSvc.saveOurs(db, alice.id, { name: "Yogurt B", nutrients: { kcal: 70 }, aliases: ["yogurt"] }, changes).food;
  foodSvc.deleteOurs(db, yogurt.id, changes);
  expect(logSvc.entriesBetween(db, alice, DAY, DAY).map((e) => e.id)).toEqual([added.id]);
  expect(foodSvc.search(db, "yogurt")[0]!.food.id).toBe(made.id);

  undoChanges(db, turn.id);
  const back = logSvc.entriesBetween(db, alice, DAY, DAY);
  expect(back.map((e) => [e.id, e.grams])).toEqual([[keep.id, 604]]);
  // the new food is gone, the old one is back with its alias, and search agrees
  expect(() => foodSvc.getFood(db, made.id, { includeDeleted: true })).toThrow();
  expect(foodSvc.getFood(db, yogurt.id).aliases).toEqual(["yogurt"]);
  expect(foodSvc.search(db, "yogurt").map((h) => h.food.id)).toContain(yogurt.id);
  expect(foodSvc.search(db, "yogurt b").map((h) => h.food.id)).not.toContain(made.id);
});

test("an entry outlives a food that undo removes", () => {
  const { db, user } = testBao();
  const alice = user("Alice");
  const thread = db.insert(warren.threads).values({ userId: alice.id, scope: DAY, model: "x" }).returning().get();
  const turn = db.insert(warren.turns).values({ threadId: thread.id }).returning().get();
  const food = foodSvc.saveOurs(db, alice.id, { name: "Granola", nutrients: { kcal: 450 } }, turnChanges(db, turn.id)).food;
  const later = logSvc.addEntry(db, alice, { day: DAY, meal: "breakfast", food_id: food.id, grams: 40 });
  undoChanges(db, turn.id);
  expect(logSvc.getEntry(db, alice, later.id)).toMatchObject({ food_id: null, kcal: 180, name: "Granola" });
});

test("only hand edits of the agent's entries are kept for audit", () => {
  const { db, user, foodId } = testBao();
  const alice = user("Alice");
  const kopi = foodId("Kopi C");
  const agent = logSvc.addEntry(db, alice, { day: DAY, meal: "breakfast", food_id: kopi, origin: "agent" });
  const gone = logSvc.addEntry(db, alice, { day: DAY, meal: "breakfast", food_id: kopi, origin: "agent" });
  const manual = logSvc.addEntry(db, alice, { day: DAY, meal: "lunch", food_id: kopi });
  logSvc.updateEntry(db, alice, agent.id, { servings: 2 }, { byHand: true });
  logSvc.updateEntry(db, alice, agent.id, {}, { byHand: true }); // nothing changed, nothing kept
  logSvc.deleteEntry(db, alice, gone.id, { byHand: true });
  logSvc.updateEntry(db, alice, manual.id, { servings: 2 }, { byHand: true });
  logSvc.updateEntry(db, alice, agent.id, { servings: 3 }); // not by hand
  const edits = db.select().from(entry_edits).where(eq(entry_edits.user_id, alice.id)).all();
  expect(edits.map((e) => [e.entry_id, e.action])).toEqual([[agent.id, "update"], [gone.id, "delete"]]);
  expect([edits[0]!.before.servings, edits[0]!.after!.servings]).toEqual([1, 2]);
  expect([edits[1]!.before.name, edits[1]!.after]).toEqual(["Kopi C", null]);
});

test("totals, daily totals and targets", () => {
  const { db, user, foodId } = testBao();
  const alice = user("Alice");
  logSvc.addEntry(db, alice, { day: DAY, meal: "lunch", food_id: foodId("Laksa") });
  logSvc.addEntry(db, alice, { day: DAY, meal: "lunch", food_id: foodId("Kopi C") });
  const days = logSvc.dailyTotals(db, alice, "2026-01-14", "2026-01-16");
  expect(days.map((d) => [d.date, d.entries, d.kcal])).toEqual([["2026-01-14", 0, 0], [DAY, 2, 524.3], ["2026-01-16", 0, 0]]);
  expect(logSvc.targets(db, alice)).toEqual({ kcal: null, protein_g: null, carb_g: null, fat_g: null });
  logSvc.setTargets(db, alice, { kcal: 1800, protein_g: 120 });
  logSvc.setTargets(db, alice, { protein_g: null });
  expect(logSvc.targets(db, alice)).toMatchObject({ kcal: 1800, protein_g: null });
  expect(() => logSvc.setTargets(db, alice, { kcal: -1 })).toThrow("negative");
});

test("quick items: recent, frequent with the usual portion, pins, saved meals and yesterday", () => {
  const { db, user, foodId } = testBao();
  const alice = user("Alice");
  const kopi = foodId("Kopi C");
  for (let i = 0; i < 3; i++) logSvc.addEntry(db, alice, { day: DAY, meal: "breakfast", food_id: kopi });
  logSvc.addEntry(db, alice, { day: DAY, meal: "breakfast", food_id: kopi, servings: 2 });
  logSvc.addEntry(db, alice, { day: DAY, meal: "lunch", food_id: foodId("Laksa") });
  const q = logSvc.quickItems(db, alice, "2026-01-16", "breakfast");
  expect(q.frequent[0]).toMatchObject({ food_id: kopi, servings: 1, serving_label: "cup" });
  expect(q.recent.map((r) => r.food_id).sort()).toEqual([kopi, foodId("Laksa")].sort());
  expect(q.yesterday).toMatchObject({ date: DAY, kcal: 537.5 });
  expect(q.yesterday!.items).toHaveLength(4);
  // entries older than 90 days and other people's don't count
  expect(logSvc.quickItems(db, alice, "2026-06-01").frequent).toEqual([]);
  expect(logSvc.quickItems(db, user("Bob"), "2026-01-16").recent).toEqual([]);

  const copies = logSvc.copyEntries(db, alice, q.yesterday!.items.slice(0, 2).map((i) => i.entry_id), "2026-01-16", "breakfast");
  expect(copies.map((c) => [c.date, c.origin, c.position])).toEqual([["2026-01-16", "quick", 0], ["2026-01-16", "quick", 1]]);
});
