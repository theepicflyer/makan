/** Food log entries, day summaries, quick adds, and people's targets. */
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { type ChangeLog, type Db, DomainError, noChanges, type User } from "warren/server";
import { addDays, round } from "./dates.js";
import * as foodSvc from "./foods.js";
import {
  entries,
  type Entry,
  entry_edits,
  type Food,
  foods,
  type Meal,
  MEALS,
  NUTRIENTS,
  type Nutrients,
  nutrientsOf,
  pins,
  profiles,
  type Profile,
  saved_meals,
} from "./schema.js";

// --- entries --------------------------------------------------------------------------------------

function checkMeal(value: string): Meal {
  let meal = value.trim().toLowerCase();
  if (meal === "supper") meal = "snacks";
  if (!(MEALS as readonly string[]).includes(meal)) {
    throw new DomainError(`meal must be one of ${MEALS.join(", ")}`);
  }
  return meal as Meal;
}

function nextPosition(db: Db, userId: number, day: string, meal: Meal): number {
  const row = db
    .select({ max: sql<number | null>`max(${entries.position})` })
    .from(entries)
    .where(and(eq(entries.user_id, userId), eq(entries.date, day), eq(entries.meal, meal)))
    .get();
  return row?.max == null ? 0 : row.max + 1;
}

export function getEntry(db: Db, user: User, id: number): Entry {
  const entry = db.select().from(entries).where(eq(entries.id, id)).get();
  if (!entry || entry.user_id !== user.id) throw new DomainError(`No entry with id ${id}`);
  return entry;
}

function foodName(food: Food): string {
  if (food.brand && !food.name.toLowerCase().includes(food.brand.toLowerCase())) {
    return `${food.brand} ${food.name}`;
  }
  return food.name;
}

function customNutrients(values: Partial<Nutrients>): Nutrients {
  if (values.kcal == null) throw new DomainError("an item without a food_id needs kcal");
  const out = {} as Nutrients;
  for (const n of NUTRIENTS) {
    const value = values[n] ?? null;
    if (value !== null && value < 0) throw new DomainError(`${n} can't be negative`);
    out[n] = value;
  }
  return out;
}

/** What an entry was, for the audit of hand edits. */
function snapshot(entry: Entry): Record<string, unknown> {
  const { id: _id, created_at: _c, updated_at: _u, ...rest } = entry;
  return rest;
}

/** Keep a person's change to an entry the agent logged, to see where the agent got it wrong. */
function recordHandEdit(db: Db, user: User, before: Entry, after: Entry | null): void {
  const was = snapshot(before);
  const is = after ? snapshot(after) : null;
  if (before.origin !== "agent" || JSON.stringify(was) === JSON.stringify(is)) return;
  db.insert(entry_edits)
    .values({ entry_id: before.id, user_id: user.id, action: is ? "update" : "delete", before: was, after: is })
    .run();
}

export interface EntryInput {
  day: string;
  meal: string;
  food_id?: number | null;
  servings?: number | null;
  serving?: string | null;
  grams?: number | null;
  name?: string | null;
  nutrients?: Partial<Nutrients> | null;
  note?: string | null;
  photo_id?: number | null;
  origin?: Entry["origin"];
}

export function addEntry(db: Db, user: User, input: EntryInput, changes: ChangeLog = noChanges): Entry {
  const meal = checkMeal(input.meal);
  let values: Partial<typeof entries.$inferInsert> & { name: string };
  if (input.food_id != null) {
    const food = foodSvc.getFood(db, input.food_id);
    const portion = foodSvc.resolvePortion(food, input);
    values = {
      food_id: food.id,
      name: input.name || foodName(food),
      ...portion,
      ...foodSvc.scale(food, portion.grams),
      is_estimate: false,
    };
  } else {
    if (!input.name) throw new DomainError("an item without a food_id needs a name");
    values = {
      name: input.name.trim(),
      servings: input.servings ?? null,
      serving_label: input.serving ?? null,
      grams: input.grams ?? null,
      ...customNutrients(input.nutrients ?? {}),
      is_estimate: true,
    };
  }
  const entry = db
    .insert(entries)
    .values({
      ...values,
      user_id: user.id,
      date: input.day,
      meal,
      note: input.note ?? null,
      photo_id: input.photo_id ?? null,
      origin: input.origin ?? "manual",
      position: nextPosition(db, user.id, input.day, meal),
    })
    .returning()
    .get();
  changes.created(entries, entry.id);
  return entry;
}

export interface EntryUpdate {
  day?: string | null;
  meal?: string | null;
  food_id?: number | null;
  servings?: number | null;
  serving?: string | null;
  grams?: number | null;
  name?: string | null;
  nutrients?: Partial<Nutrients> | null;
  note?: string | null;
}

export function updateEntry(
  db: Db,
  user: User,
  id: number,
  input: EntryUpdate,
  options: { changes?: ChangeLog; byHand?: boolean } = {},
): Entry {
  const entry = getEntry(db, user, id);
  const { servings, serving, grams, name } = input;
  const set: Partial<typeof entries.$inferInsert> = {};

  if (input.day != null || input.meal != null) {
    const day = input.day ?? entry.date;
    const meal = input.meal != null ? checkMeal(input.meal) : entry.meal;
    if (day !== entry.date || meal !== entry.meal) {
      Object.assign(set, { date: day, meal, position: nextPosition(db, user.id, day, meal) });
    }
  }
  if (input.note != null) set.note = input.note || null;

  const portionChanged = servings != null || serving != null || grams != null;
  const targetFoodId = input.food_id ?? entry.food_id;
  // Only the numbers given replace the entry's own; the rest stay.
  const given = Object.fromEntries(Object.entries(input.nutrients ?? {}).filter(([, v]) => v != null));
  if (Object.keys(given).length) {
    // Explicit totals win: the entry becomes a custom estimate.
    if (name != null) set.name = name.trim();
    if (portionChanged) {
      Object.assign(set, { servings: servings ?? null, serving_label: serving ?? null, grams: grams ?? null });
    }
    Object.assign(set, customNutrients({ ...nutrientsOf(entry), ...given }));
    set.food_id = input.food_id ?? null;
    set.is_estimate = true;
  } else if (targetFoodId != null && (input.food_id != null || portionChanged)) {
    const food = foodSvc.getFood(db, targetFoodId, { includeDeleted: true });
    let portion: foodSvc.Portion;
    if (input.food_id == null && !portionChanged) {
      portion = { grams: entry.grams ?? 100, servings: entry.servings, serving_label: entry.serving_label };
    } else if (grams == null && servings != null && serving == null && input.food_id == null && entry.serving_label) {
      // "make that 2": keep the serving, change the count
      portion = foodSvc.resolvePortion(food, { servings, serving: entry.serving_label });
    } else {
      portion = foodSvc.resolvePortion(food, { servings, serving, grams });
    }
    Object.assign(set, {
      food_id: food.id,
      ...portion,
      ...foodSvc.scale(food, portion.grams),
      name: name ? name.trim() : foodName(food),
      is_estimate: false,
    });
  } else if (portionChanged) {
    // Custom item: scale its totals with the portion count.
    const old = entry.servings || 1;
    const next = servings ?? old;
    if (next <= 0) throw new DomainError("servings must be positive");
    const ratio = next / old;
    for (const n of NUTRIENTS) {
      if (entry[n] !== null) set[n] = round(entry[n] * ratio, 2);
    }
    set.servings = next;
    if (serving != null) set.serving_label = serving;
    if (grams != null) set.grams = grams;
    if (name != null) set.name = name.trim();
  } else if (name != null) {
    set.name = name.trim();
  }

  (options.changes ?? noChanges).track(entries, id, () => {
    if (Object.keys(set).length) db.update(entries).set(set).where(eq(entries.id, id)).run();
  });
  const updated = getEntry(db, user, id);
  if (options.byHand) recordHandEdit(db, user, entry, updated);
  return updated;
}

export function deleteEntry(
  db: Db,
  user: User,
  id: number,
  options: { changes?: ChangeLog; byHand?: boolean } = {},
): Entry {
  const entry = getEntry(db, user, id);
  (options.changes ?? noChanges).track(entries, id, () =>
    db.delete(entries).where(eq(entries.id, id)).run(),
  );
  if (options.byHand) recordHandEdit(db, user, entry, null);
  return entry;
}

export function entriesBetween(db: Db, user: User, start: string, end: string): Entry[] {
  return db
    .select()
    .from(entries)
    .where(and(eq(entries.user_id, user.id), gte(entries.date, start), lte(entries.date, end)))
    .orderBy(asc(entries.date), asc(entries.meal), asc(entries.position), asc(entries.id))
    .all();
}

export function totals(items: Entry[]): Record<(typeof NUTRIENTS)[number], number> {
  const out = Object.fromEntries(NUTRIENTS.map((n) => [n, 0])) as Record<(typeof NUTRIENTS)[number], number>;
  for (const e of items) for (const n of NUTRIENTS) out[n] += e[n] ?? 0;
  for (const n of NUTRIENTS) out[n] = round(out[n], 1);
  return out;
}

export function dailyTotals(db: Db, user: User, start: string, end: string) {
  const byDay = new Map<string, Entry[]>();
  for (const e of entriesBetween(db, user, start, end)) {
    byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
  }
  const out = [];
  for (let day = start; day <= end; day = addDays(day, 1)) {
    const items = byDay.get(day) ?? [];
    out.push({ date: day, entries: items.length, ...totals(items) });
  }
  return out;
}

// --- profiles -------------------------------------------------------------------------------------

export function profileOf(db: Db, user: User): Profile {
  const found = db.select().from(profiles).where(eq(profiles.user_id, user.id)).get();
  return found ?? db.insert(profiles).values({ user_id: user.id }).returning().get();
}

export interface Targets {
  kcal: number | null;
  protein_g: number | null;
  carb_g: number | null;
  fat_g: number | null;
}

export function targets(db: Db, user: User): Targets {
  const p = profileOf(db, user);
  return { kcal: p.kcal_target, protein_g: p.protein_target_g, carb_g: p.carb_target_g, fat_g: p.fat_target_g };
}

const TARGET_COLUMNS = {
  kcal: "kcal_target",
  protein_g: "protein_target_g",
  carb_g: "carb_target_g",
  fat_g: "fat_target_g",
} as const;

export function setTargets(db: Db, user: User, values: Partial<Targets>): void {
  const set: Partial<Profile> = {};
  for (const [key, column] of Object.entries(TARGET_COLUMNS) as [keyof Targets, keyof typeof set][]) {
    if (!(key in values)) continue;
    const value = values[key] ?? null;
    if (value !== null && value < 0) throw new DomainError(`${key} target can't be negative`);
    (set as Record<string, number | null>)[column] = value;
  }
  profileOf(db, user);
  if (Object.keys(set).length) db.update(profiles).set(set).where(eq(profiles.user_id, user.id)).run();
}

// --- quick adds -----------------------------------------------------------------------------------

export interface QuickItem {
  food_id: number;
  name: string;
  serving_label: string | null;
  servings: number | null;
  grams: number | null;
  kcal: number | null;
}

function quickItem(e: Entry): QuickItem {
  return {
    food_id: e.food_id!,
    name: e.name,
    serving_label: e.serving_label,
    servings: e.servings,
    grams: e.serving_label ? null : e.grams,
    kcal: e.kcal,
  };
}

const portionKey = (e: Entry) => JSON.stringify([e.serving_label, e.servings, e.serving_label ? null : e.grams]);

/** Entries from the last 90 days that link a food still in the database, newest first. */
function recentFoodEntries(db: Db, user: User, day: string): Entry[] {
  const recent = db
    .select()
    .from(entries)
    .where(and(eq(entries.user_id, user.id), isNotNull(entries.food_id), gte(entries.date, addDays(day, -90))))
    .orderBy(desc(entries.created_at), desc(entries.id))
    .limit(400)
    .all();
  const ids = [...new Set(recent.map((e) => e.food_id!))];
  if (!ids.length) return [];
  const live = new Set(
    db
      .select({ id: foods.id })
      .from(foods)
      .where(and(inArray(foods.id, ids), isNull(foods.deleted_at)))
      .all()
      .map((f) => f.id),
  );
  return recent.filter((e) => live.has(e.food_id!));
}

/** The foods a person logs most, each with its usual portion; a meal's own foods count triple. */
export function frequentItems(db: Db, user: User, day: string, meal?: string | null): QuickItem[] {
  const counts = new Map<number, number>();
  const portions = new Map<number, Map<string, number>>();
  const latest = new Map<string, Entry>();
  for (const e of recentFoodEntries(db, user, day)) {
    const id = e.food_id!;
    counts.set(id, (counts.get(id) ?? 0) + (meal && e.meal === meal ? 3 : 1));
    const key = portionKey(e);
    const forFood = portions.get(id) ?? new Map<string, number>();
    forFood.set(key, (forFood.get(key) ?? 0) + 1);
    portions.set(id, forFood);
    if (!latest.has(`${id}:${key}`)) latest.set(`${id}:${key}`, e);
  }
  // Map order is first-seen order, so ties go to the more recently logged, as a stable sort keeps them.
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([id]) => {
      const usual = [...portions.get(id)!.entries()].sort((a, b) => b[1] - a[1])[0]![0];
      return quickItem(latest.get(`${id}:${usual}`)!);
    });
}

export function quickItems(db: Db, user: User, day: string, meal?: string | null) {
  const recent: QuickItem[] = [];
  const seen = new Set<number>();
  for (const e of recentFoodEntries(db, user, day)) {
    if (seen.has(e.food_id!)) continue;
    seen.add(e.food_id!);
    recent.push(quickItem(e));
    if (recent.length >= 12) break;
  }

  const pinned = [];
  const rows = db
    .select({ pin: pins, food: foods })
    .from(pins)
    .innerJoin(foods, eq(pins.food_id, foods.id))
    .where(and(eq(pins.user_id, user.id), isNull(foods.deleted_at)))
    .orderBy(asc(pins.position), asc(pins.id))
    .all();
  for (const { pin, food } of rows) {
    const portion = foodSvc.resolvePortion(food, { servings: pin.servings, serving: pin.serving_label, grams: pin.grams });
    pinned.push({
      id: pin.id,
      food_id: food.id,
      name: foodName(food),
      serving_label: portion.serving_label,
      servings: portion.servings,
      grams: pin.grams,
      kcal: foodSvc.scale(food, portion.grams).kcal,
    });
  }

  const meals = db
    .select({ id: saved_meals.id, name: saved_meals.name, items: saved_meals.items })
    .from(saved_meals)
    .where(eq(saved_meals.user_id, user.id))
    .orderBy(asc(saved_meals.name))
    .all();

  let yesterday = null;
  if (meal) {
    const date = addDays(day, -1);
    const prev = db
      .select()
      .from(entries)
      .where(and(eq(entries.user_id, user.id), eq(entries.date, date), eq(entries.meal, meal as Meal)))
      .orderBy(asc(entries.position))
      .all();
    if (prev.length) {
      yesterday = {
        date,
        items: prev.map((e) => ({ entry_id: e.id, name: e.name, kcal: e.kcal })),
        kcal: totals(prev).kcal,
      };
    }
  }

  return { pins: pinned, saved_meals: meals, frequent: frequentItems(db, user, day, meal), recent, yesterday };
}

export function copyEntries(db: Db, user: User, ids: number[], day: string, meal: string): Entry[] {
  const to = checkMeal(meal);
  return ids.map((id) => {
    const { id: _id, created_at: _c, updated_at: _u, photo_id: _p, ...rest } = getEntry(db, user, id);
    return db
      .insert(entries)
      .values({ ...rest, date: day, meal: to, origin: "quick", position: nextPosition(db, user.id, day, to) })
      .returning()
      .get();
  });
}

export function logSavedMeal(db: Db, user: User, mealId: number, day: string, meal: string): Entry[] {
  const saved = db.select().from(saved_meals).where(eq(saved_meals.id, mealId)).get();
  if (!saved || saved.user_id !== user.id) throw new DomainError(`No saved meal with id ${mealId}`);
  return saved.items.map((item) =>
    addEntry(db, user, {
      day,
      meal,
      food_id: item.food_id,
      servings: item.servings,
      serving: item.serving_label,
      grams: item.grams,
      origin: "quick",
    }),
  );
}
