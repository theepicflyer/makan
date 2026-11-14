/**
 * Bao's tables. Property names are the column names (snake_case), so a row is also its API shape
 * and its undo snapshot. People, agent threads, files and push subscriptions are Warren's tables.
 */
import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { schema as warren } from "warren/server";

export const NUTRIENTS = [
  "kcal",
  "protein_g",
  "carb_g",
  "fat_g",
  "fibre_g",
  "sugar_g",
  "sodium_mg",
  "sat_fat_g",
] as const;
export type Nutrient = (typeof NUTRIENTS)[number];
export type Nutrients = Record<Nutrient, number | null>;

export const MEALS = ["breakfast", "lunch", "dinner", "snacks"] as const;
export type Meal = (typeof MEALS)[number];

export const SOURCES = ["ours", "sgfoodid", "usda"] as const;
export type Source = (typeof SOURCES)[number];

export interface Serving {
  label: string;
  grams: number;
  default?: boolean;
}

const now = sql`(unixepoch('subsec') * 1000)`;
const created_at = () => integer("created_at", { mode: "timestamp_ms" }).notNull().default(now);
const updated_at = () =>
  integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(now)
    .$onUpdate(() => new Date());

const nutrientColumns = () => ({
  kcal: real("kcal"),
  protein_g: real("protein_g"),
  carb_g: real("carb_g"),
  fat_g: real("fat_g"),
  fibre_g: real("fibre_g"),
  sugar_g: real("sugar_g"),
  sodium_mg: real("sodium_mg"),
  sat_fat_g: real("sat_fat_g"),
});

/** A person's settings in Bao. Made the first time they are needed. */
export const profiles = sqliteTable("profiles", {
  user_id: integer("user_id")
    .primaryKey()
    .references(() => warren.users.id, { onDelete: "cascade" }),
  kcal_target: real("kcal_target"),
  protein_target_g: real("protein_target_g"),
  carb_target_g: real("carb_target_g"),
  fat_target_g: real("fat_target_g"),
  /** Daily reminder to log, "HH:MM" in the app's timezone, sent to each of the person's devices. */
  reminder_time: text("reminder_time").notNull().default("21:00"),
  /** The log date the last reminder was settled for (sent or skipped), so each day gets at most one. */
  reminded_on: text("reminded_on"),
});

/** A food with nutrients per 100 g. Reference sources are read-only; "ours" is editable. */
export const foods = sqliteTable(
  "foods",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    source: text("source").$type<Source>().notNull(),
    source_ref: text("source_ref"),
    name: text("name").notNull(),
    brand: text("brand"),
    description: text("description"),
    category: text("category"),
    /** [{"label": "bowl", "grams": 604, "default": true}] */
    servings: text("servings", { mode: "json" }).$type<Serving[]>().notNull().default([]),
    /** Generic words this food stands for in the household, e.g. ["yogurt"] */
    aliases: text("aliases", { mode: "json" }).$type<string[]>().notNull().default([]),
    meta: text("meta", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    created_by: integer("created_by").references(() => warren.users.id),
    created_at: created_at(),
    updated_at: updated_at(),
    deleted_at: integer("deleted_at", { mode: "timestamp_ms" }),
    ...nutrientColumns(),
  },
  (t) => [uniqueIndex("foods_source_ref").on(t.source, t.source_ref), index("foods_source").on(t.source)],
);

/** One logged item. Nutrients are totals for the portion, copied at log time. */
export const entries = sqliteTable(
  "entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    user_id: integer("user_id")
      .notNull()
      .references(() => warren.users.id),
    /** YYYY-MM-DD */
    date: text("date").notNull(),
    meal: text("meal").$type<Meal>().notNull(),
    position: integer("position").notNull().default(0),
    // Entries keep their own numbers, so one outlives its food.
    food_id: integer("food_id").references(() => foods.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    serving_label: text("serving_label"),
    servings: real("servings"),
    grams: real("grams"),
    is_estimate: integer("is_estimate", { mode: "boolean" }).notNull().default(false),
    note: text("note"),
    /** The photo it was logged from: a Warren file. */
    photo_id: integer("photo_id").references(() => warren.files.id),
    origin: text("origin").$type<"manual" | "quick" | "agent">().notNull().default("manual"),
    created_at: created_at(),
    updated_at: updated_at(),
    ...nutrientColumns(),
  },
  (t) => [index("entries_user_date").on(t.user_id, t.date)],
);

/** A quick-add shortcut for one food and portion. */
export const pins = sqliteTable(
  "pins",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    user_id: integer("user_id")
      .notNull()
      .references(() => warren.users.id),
    food_id: integer("food_id")
      .notNull()
      .references(() => foods.id, { onDelete: "cascade" }),
    serving_label: text("serving_label"),
    servings: real("servings"),
    grams: real("grams"),
    position: integer("position").notNull().default(0),
    created_at: created_at(),
  },
  (t) => [index("pins_user").on(t.user_id)],
);

export interface SavedMealItem {
  food_id: number;
  serving_label?: string | null;
  servings?: number | null;
  grams?: number | null;
  name?: string;
}

/** A named group of items logged together, e.g. "usual breakfast". */
export const saved_meals = sqliteTable(
  "saved_meals",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    user_id: integer("user_id")
      .notNull()
      .references(() => warren.users.id),
    name: text("name").notNull(),
    items: text("items", { mode: "json" }).$type<SavedMealItem[]>().notNull().default([]),
    created_at: created_at(),
  },
  (t) => [index("saved_meals_user").on(t.user_id)],
);

/** A hand edit or delete of an entry the agent logged, kept to audit the agent. Not part of undo. */
export const entry_edits = sqliteTable(
  "entry_edits",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    entry_id: integer("entry_id").notNull(),
    user_id: integer("user_id")
      .notNull()
      .references(() => warren.users.id),
    action: text("action").$type<"update" | "delete">().notNull(),
    before: text("before", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    after: text("after", { mode: "json" }).$type<Record<string, unknown> | null>(),
    created_at: created_at(),
  },
  (t) => [index("entry_edits_entry").on(t.entry_id), index("entry_edits_user").on(t.user_id)],
);

export type Food = typeof foods.$inferSelect;
export type Entry = typeof entries.$inferSelect;
export type Pin = typeof pins.$inferSelect;
export type SavedMeal = typeof saved_meals.$inferSelect;
export type Profile = typeof profiles.$inferSelect;

export function nutrientsOf(row: Nutrients): Nutrients {
  return Object.fromEntries(NUTRIENTS.map((n) => [n, row[n]])) as Nutrients;
}
