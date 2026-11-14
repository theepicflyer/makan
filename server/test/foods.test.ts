import { DomainError } from "warren/server";
import { expect, test } from "vitest";
import * as foodSvc from "../src/foods.js";
import { REFERENCE, referenceDir, testBao } from "./helpers.js";

test("search finds a hawker dish, prefixes and several words", () => {
  const { db } = testBao();
  expect(foodSvc.search(db, "laksa")[0]!.food.name).toBe("Laksa");
  expect(foodSvc.search(db, "kopi")[0]!.food.name).toBe("Kopi C");
  expect(foodSvc.search(db, "greek yogurt")[0]!.food.source).toBe("usda");
  expect(foodSvc.search(db, "  ")).toEqual([]);
  expect(foodSvc.search(db, "zzzz")).toEqual([]);
});

test("a plural finds the singular", () => {
  const { db } = testBao();
  expect(foodSvc.search(db, "eggs")[0]!.food.name).toBe("Egg, whole, raw, fresh");
  expect(foodSvc.search(db, "kaya toasts")[0]!.food.name).toBe("Kaya toast");
});

test("hawker spellings are tried as written and as the database spells them", () => {
  expect(foodSvc.queryVariants("Bee Hoon")).toEqual(["bee hoon", "beehoon"]);
  expect(foodSvc.queryVariants("kopi c peng")).toEqual(["kopi c peng", "iced kopi c"]);
  expect(foodSvc.queryVariants("char kuey teow")).toContain("char kway teow");
});

test("a household food wins for its aliases", () => {
  const { db, user } = testBao();
  const { food, created } = foodSvc.saveOurs(db, user("Alice").id, {
    name: "Chobani Greek Light",
    brand: "Chobani",
    nutrients: { kcal: 55, protein_g: 9.4, carb_g: 4.1, fat_g: 0 },
    servings: [{ label: "tub", grams: 150 }, { label: "bowl", grams: 170 }],
    aliases: ["Yogurt", "greek yogurt"],
  });
  expect(created).toBe(true);
  expect(food.aliases).toEqual(["yogurt", "greek yogurt"]);
  expect(food.servings.map((s) => s.default)).toEqual([true, false]);
  const hit = foodSvc.search(db, "yogurt")[0]!;
  expect([hit.food.id, hit.alias_match]).toEqual([food.id, true]);
  expect(foodSvc.search(db, "greek yogurt")[0]!.food.id).toBe(food.id);
  // found by brand too
  expect(foodSvc.search(db, "chobani")[0]!.food.id).toBe(food.id);
});

test("an alias belongs to one household food; saving it on another moves it", () => {
  const { db, user } = testBao();
  const alice = user("Alice").id;
  const a = foodSvc.saveOurs(db, alice, { name: "Yogurt A", nutrients: { kcal: 60 }, aliases: ["yogurt"] }).food;
  const b = foodSvc.saveOurs(db, alice, { name: "Yogurt B", nutrients: { kcal: 70 }, aliases: ["yogurt"] }).food;
  expect(foodSvc.getFood(db, a.id).aliases).toEqual([]);
  expect(b.aliases).toEqual(["yogurt"]);
  expect(foodSvc.search(db, "yogurt")[0]!.food.id).toBe(b.id);
});

test("a deleted household food leaves search but can still be looked up", () => {
  const { db, user } = testBao();
  const { food } = foodSvc.saveOurs(db, user("Alice").id, { name: "Oat Drink", nutrients: { kcal: 45 } });
  foodSvc.deleteOurs(db, food.id);
  expect(foodSvc.search(db, "oat drink")).toEqual([]);
  expect(() => foodSvc.getFood(db, food.id)).toThrow(DomainError);
  expect(foodSvc.getFood(db, food.id, { includeDeleted: true }).name).toBe("Oat Drink");
});

test("reference foods are read-only, and a new food needs a name and calories", () => {
  const { db, user, foodId } = testBao();
  const alice = user("Alice").id;
  expect(() => foodSvc.saveOurs(db, alice, { food_id: foodId("Laksa"), name: "Edited" })).toThrow("reference data");
  expect(() => foodSvc.deleteOurs(db, foodId("Laksa"))).toThrow("reference data");
  expect(() => foodSvc.saveOurs(db, alice, { nutrients: { kcal: 1 } })).toThrow("needs a name");
  expect(() => foodSvc.saveOurs(db, alice, { name: "X" })).toThrow("needs kcal");
  expect(() => foodSvc.saveOurs(db, alice, { name: "X", nutrients: { kcal: -1 } })).toThrow("negative");
});

test("portions resolve from servings, counts, weights and units", () => {
  const { db, foodId } = testBao();
  const laksa = foodSvc.getFood(db, foodId("Laksa"));
  expect(foodSvc.resolvePortion(laksa).grams).toBe(604);
  expect(foodSvc.resolvePortion(laksa, { servings: 0.5, serving: "1 bowl(s)" }).grams).toBe(302);
  expect(foodSvc.resolvePortion(laksa, { grams: 250 })).toEqual({ grams: 250, servings: null, serving_label: null });
  expect(foodSvc.resolvePortion(laksa, { servings: 2, serving: "100 g" })).toEqual({ grams: 200, servings: 2, serving_label: "100 g" });
  expect(foodSvc.resolvePortion(laksa, { servings: 30, serving: "g" }).grams).toBe(30);
  expect(() => foodSvc.resolvePortion(laksa, { serving: "plate" })).toThrow("no 'plate' serving (known: bowl)");
  expect(foodSvc.scale(laksa, 604).kcal).toBeCloseTo(416.76);
  expect(foodSvc.describePortion(2, "slice", 90)).toBe("2 × slice (90 g)");
  expect(foodSvc.describePortion(null, null, 250)).toBe("250 g");
});

test("reloading the reference keeps ids, applies aliases and retires foods that are gone", () => {
  const bao = testBao();
  const { db, foodId } = bao;
  const laksa = foodId("Laksa");
  expect(foodSvc.loadReference(db, bao.reference)).toBe(0); // unchanged files load nothing

  const next = referenceDir(
    [{ ...REFERENCE[0]!, description: "Updated" }, ...REFERENCE.slice(2)],
    { "sgfoodid:Laksa": ["Curry Mee"], "sgfoodid:Nope": ["x"], _comment: ["ignored"] },
  );
  expect(foodSvc.loadReference(db, next)).toBe(4);
  expect(foodId("Laksa")).toBe(laksa);
  expect(foodSvc.getFood(db, laksa)).toMatchObject({ description: "Updated", aliases: ["curry mee"] });
  expect(foodSvc.search(db, "curry mee")[0]!.food.id).toBe(laksa);
  expect(foodSvc.search(db, "kopi")).toEqual([]);
  expect(foodSvc.getFood(db, foodId("Kopi C"), { includeDeleted: true }).deleted_at).not.toBeNull();
});
