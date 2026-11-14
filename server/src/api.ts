/** JSON API for the web app. Everything here is under /api and needs a signed-in person. */
import fs from "node:fs";
import path from "node:path";
import { and, eq, gte, sql } from "drizzle-orm";
import type { Hono } from "hono";
import { type AppContext, type AppEnv, DomainError, schema as warren, type User } from "warren/server";
import { z } from "zod";
import { daysBetween, instant, logDay, parseDay, round } from "./dates.js";
import * as foodSvc from "./foods.js";
import * as logSvc from "./log.js";
import * as reminders from "./reminders.js";
import {
  type Entry,
  entries,
  type Food,
  foods,
  MEALS,
  NUTRIENTS,
  type Nutrients,
  nutrientsOf,
  pins,
  saved_meals,
  type SavedMealItem,
} from "./schema.js";

// --- serializers ----------------------------------------------------------------------------------

export function foodOut(food: Food) {
  return {
    id: food.id,
    source: food.source,
    source_label: foodSvc.SOURCE_LABEL[food.source],
    name: food.name,
    brand: food.brand,
    description: food.description,
    category: food.category,
    per_100g: nutrientsOf(food),
    servings: food.servings,
    aliases: food.aliases,
    editable: food.source === "ours",
  };
}

export function entryOut(entry: Entry) {
  return {
    id: entry.id,
    date: entry.date,
    meal: entry.meal,
    food_id: entry.food_id,
    name: entry.name,
    portion: foodSvc.describePortion(entry.servings, entry.serving_label, entry.grams),
    servings: entry.servings,
    serving_label: entry.serving_label,
    grams: entry.grams,
    is_estimate: entry.is_estimate,
    note: entry.note,
    photo_id: entry.photo_id,
    origin: entry.origin,
    ...nutrientsOf(entry),
  };
}

/** A person's Bao settings, added to Warren's GET /api/me. */
export function meOut(user: User, ctx: AppContext) {
  return {
    targets: logSvc.targets(ctx.db, user),
    today: logDay(new Date(), ctx.config.timezone),
    timezone: ctx.config.timezone,
    reminder_time: logSvc.profileOf(ctx.db, user).reminder_time,
  };
}

// --- request shapes -------------------------------------------------------------------------------

const meal = z.enum(MEALS);
const positive = z.number().positive().nullish();
const nutrients = z.record(z.string(), z.number().nullable()).nullish();
const targetValue = z.number().nullable().optional();

const MeUpdate = z.object({
  name: z.string().nullish(),
  targets: z
    .object({ kcal: targetValue, protein_g: targetValue, carb_g: targetValue, fat_g: targetValue })
    .nullish(),
  reminder_time: z.string().nullish(),
});
const EntryIn = z.object({
  date: z.string(),
  meal,
  food_id: z.number().int().nullish(),
  servings: positive,
  serving: z.string().nullish(),
  grams: positive,
  name: z.string().nullish(),
  nutrients,
  note: z.string().nullish(),
  origin: z.enum(["manual", "quick"]).default("manual"),
});
const EntryPatch = EntryIn.omit({ origin: true }).partial();
const CopyIn = z.object({ entry_ids: z.array(z.number().int()), date: z.string(), meal });
const FoodIn = z.object({
  name: z.string().nullish(),
  brand: z.string().nullish(),
  description: z.string().nullish(),
  basis: z.enum(["per_100g", "per_serving"]).default("per_100g"),
  serving_grams: positive,
  nutrients,
  servings: z.array(z.record(z.string(), z.unknown())).nullish(),
  aliases: z.array(z.string()).nullish(),
});
const PinIn = z.object({
  food_id: z.number().int(),
  serving_label: z.string().nullish(),
  servings: positive,
  grams: positive,
});
const SavedMealIn = z.object({
  name: z.string(),
  items: z.array(z.record(z.string(), z.unknown())).nullish(),
  entry_ids: z.array(z.number().int()).nullish(),
});
const LogSavedIn = z.object({ date: z.string(), meal });

function perHundred(body: z.infer<typeof FoodIn>): Partial<Nutrients> | null {
  if (body.nutrients == null) return null;
  const values = Object.fromEntries(
    Object.entries(body.nutrients).filter(([k]) => (NUTRIENTS as readonly string[]).includes(k)),
  ) as Partial<Nutrients>;
  if (body.basis !== "per_serving") return values;
  if (!body.serving_grams) throw new DomainError("serving_grams is required for per-serving nutrients");
  const factor = 100 / body.serving_grams;
  return Object.fromEntries(
    Object.entries(values).map(([k, v]) => [k, v == null ? null : round(v * factor, 2)]),
  );
}

class NotFound extends Error {}
class Invalid extends Error {}

/** Mount Bao's routes. A DomainError anywhere becomes a 400 with its message (Warren does that). */
export function routes(api: Hono<AppEnv>, ctx: AppContext, referenceDir: string): void {
  const { db, config } = ctx;
  const tz = config.timezone;

  /** Parse a JSON body against a schema; a bad one is a 422. */
  async function body<S extends z.ZodType>(c: { req: { json(): Promise<unknown> } }, schema: S): Promise<z.infer<S>> {
    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new Invalid();
    return parsed.data;
  }
  api.onError((err, c) => {
    if (err instanceof Invalid) return c.json({ detail: "Invalid request" }, 422);
    if (err instanceof NotFound) return c.json({ detail: err.message || "Not found" }, 404);
    if (err instanceof DomainError) return c.json({ detail: err.message }, 400);
    console.error(`bao: ${c.req.method} ${c.req.path} failed`, err);
    return c.json({ detail: "Something went wrong" }, 500);
  });
  const id = (value: string): number => {
    const n = Number(value);
    if (!Number.isInteger(n)) throw new NotFound();
    return n;
  };
  /** A lookup that fails means the thing isn't there (or isn't theirs): 404, not 400. */
  const found = <T>(fn: () => T): T => {
    try {
      return fn();
    } catch (err) {
      if (err instanceof DomainError) throw new NotFound(err.message);
      throw err;
    }
  };

  // --- me / days ---------------------------------------------------------------------------------

  api.patch("/me", async (c) => {
    const user = c.var.user;
    const input = await body(c, MeUpdate);
    db.transaction((tx) => {
      if (input.name?.trim()) {
        tx.update(warren.users).set({ name: input.name.trim() }).where(eq(warren.users.id, user.id)).run();
      }
      if (input.targets != null) logSvc.setTargets(tx, user, input.targets);
      if (input.reminder_time != null) reminders.setTime(tx, user, input.reminder_time, tz);
    });
    const fresh = db.select().from(warren.users).where(eq(warren.users.id, user.id)).get()!;
    return c.json({ id: fresh.id, name: fresh.name, email: fresh.email, ...meOut(fresh, ctx) });
  });

  api.get("/days/:day", (c) => {
    const user = c.var.user;
    const day = parseDay(c.req.param("day"));
    const items = logSvc.entriesBetween(db, user, day, day);
    return c.json({
      date: day,
      meals: Object.fromEntries(MEALS.map((m) => [m, items.filter((e) => e.meal === m).map(entryOut)])),
      meal_totals: Object.fromEntries(MEALS.map((m) => [m, logSvc.totals(items.filter((e) => e.meal === m))])),
      totals: logSvc.totals(items),
      targets: logSvc.targets(db, user),
    });
  });

  api.get("/history", (c) => {
    const start = parseDay(c.req.query("start") ?? "");
    const end = parseDay(c.req.query("end") ?? "");
    if (daysBetween(start, end) > 400) throw new DomainError("range too long");
    return c.json({
      days: logSvc.dailyTotals(db, c.var.user, start, end),
      targets: logSvc.targets(db, c.var.user),
    });
  });

  // --- entries -----------------------------------------------------------------------------------

  api.post("/entries", async (c) => {
    const input = await body(c, EntryIn);
    const entry = db.transaction((tx) =>
      logSvc.addEntry(tx, c.var.user, { ...input, day: parseDay(input.date) }),
    );
    return c.json(entryOut(entry));
  });

  api.post("/entries/copy", async (c) => {
    const input = await body(c, CopyIn);
    const copies = db.transaction((tx) =>
      logSvc.copyEntries(tx, c.var.user, input.entry_ids, parseDay(input.date), input.meal),
    );
    return c.json({ entries: copies.map(entryOut) });
  });

  api.patch("/entries/:id", async (c) => {
    const input = await body(c, EntryPatch);
    const entry = db.transaction((tx) =>
      logSvc.updateEntry(
        tx,
        c.var.user,
        id(c.req.param("id")),
        { ...input, day: input.date ? parseDay(input.date) : null },
        { byHand: true },
      ),
    );
    return c.json(entryOut(entry));
  });

  api.delete("/entries/:id", (c) => {
    found(() => db.transaction((tx) => logSvc.deleteEntry(tx, c.var.user, id(c.req.param("id")), { byHand: true })));
    return c.json({ ok: true });
  });

  // --- foods -------------------------------------------------------------------------------------

  api.get("/foods/search", (c) => {
    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 20) || 20, 1), 50);
    const hits = foodSvc.search(db, c.req.query("q") ?? "", limit);
    return c.json({ results: hits.map((h) => foodOut(h.food)) });
  });

  api.get("/foods/ours", (c) => c.json({ foods: foodSvc.oursFoods(db).map(foodOut) }));

  api.get("/foods/:id", (c) =>
    c.json(foodOut(found(() => foodSvc.getFood(db, id(c.req.param("id")), { includeDeleted: true })))),
  );

  api.post("/foods", async (c) => {
    const input = await body(c, FoodIn);
    const { food } = db.transaction((tx) =>
      foodSvc.saveOurs(tx, c.var.user.id, {
        name: input.name,
        brand: input.brand,
        description: input.description,
        nutrients: perHundred(input),
        servings: input.servings ?? [],
        aliases: input.aliases ?? [],
      }),
    );
    return c.json(foodOut(food));
  });

  api.patch("/foods/:id", async (c) => {
    const input = await body(c, FoodIn);
    const { food } = db.transaction((tx) =>
      foodSvc.saveOurs(tx, c.var.user.id, {
        food_id: id(c.req.param("id")),
        name: input.name,
        brand: input.brand,
        description: input.description,
        nutrients: perHundred(input),
        servings: input.servings,
        aliases: input.aliases,
      }),
    );
    return c.json(foodOut(food));
  });

  api.delete("/foods/:id", (c) => {
    db.transaction((tx) => foodSvc.deleteOurs(tx, id(c.req.param("id"))));
    return c.json({ ok: true });
  });

  // --- quick adds --------------------------------------------------------------------------------

  api.get("/quick", (c) => {
    const day = c.req.query("day");
    return c.json(
      logSvc.quickItems(db, c.var.user, day ? parseDay(day) : logDay(new Date(), tz), c.req.query("meal")),
    );
  });

  api.post("/pins", async (c) => {
    const input = await body(c, PinIn);
    const user = c.var.user;
    const food = foodSvc.getFood(db, input.food_id);
    foodSvc.resolvePortion(food, { servings: input.servings, serving: input.serving_label, grams: input.grams });
    const last = db
      .select({ max: sql<number | null>`max(${pins.position})` })
      .from(pins)
      .where(eq(pins.user_id, user.id))
      .get();
    const pin = db
      .insert(pins)
      .values({
        user_id: user.id,
        food_id: food.id,
        serving_label: input.serving_label ?? null,
        servings: input.servings ?? null,
        grams: input.grams ?? null,
        position: (last?.max ?? 0) + 1,
      })
      .returning({ id: pins.id })
      .get();
    return c.json({ id: pin.id });
  });

  api.delete("/pins/:id", (c) => {
    const gone = db
      .delete(pins)
      .where(and(eq(pins.id, id(c.req.param("id"))), eq(pins.user_id, c.var.user.id)))
      .run();
    if (!gone.changes) throw new NotFound();
    return c.json({ ok: true });
  });

  api.post("/saved-meals", async (c) => {
    const input = await body(c, SavedMealIn);
    const user = c.var.user;
    const items = [...(input.items ?? [])] as unknown as SavedMealItem[];
    for (const entryId of input.entry_ids ?? []) {
      const entry = db.select().from(entries).where(eq(entries.id, entryId)).get();
      if (!entry || entry.user_id !== user.id || entry.food_id === null) continue;
      items.push({
        food_id: entry.food_id,
        serving_label: entry.serving_label,
        servings: entry.servings,
        grams: entry.serving_label ? null : entry.grams,
        name: entry.name,
      });
    }
    if (!input.name.trim() || !items.length) {
      throw new DomainError("A saved meal needs a name and at least one database food");
    }
    const saved = db
      .insert(saved_meals)
      .values({ user_id: user.id, name: input.name.trim(), items })
      .returning()
      .get();
    return c.json({ id: saved.id, name: saved.name, items: saved.items });
  });

  api.delete("/saved-meals/:id", (c) => {
    const gone = db
      .delete(saved_meals)
      .where(and(eq(saved_meals.id, id(c.req.param("id"))), eq(saved_meals.user_id, c.var.user.id)))
      .run();
    if (!gone.changes) throw new NotFound();
    return c.json({ ok: true });
  });

  api.post("/saved-meals/:id/log", async (c) => {
    const input = await body(c, LogSavedIn);
    const logged = db.transaction((tx) =>
      logSvc.logSavedMeal(tx, c.var.user, id(c.req.param("id")), parseDay(input.date), input.meal),
    );
    return c.json({ entries: logged.map(entryOut) });
  });

  // --- about -------------------------------------------------------------------------------------

  api.get("/usage", (c) => {
    const today = logDay(new Date(), tz);
    const monthStart = instant(`${today.slice(0, 8)}01`, 0, 0, tz);
    const rows = db
      .select({ cost: warren.turns.costUsd })
      .from(warren.turns)
      .innerJoin(warren.threads, eq(warren.turns.threadId, warren.threads.id))
      .where(and(eq(warren.threads.userId, c.var.user.id), gte(warren.turns.createdAt, monthStart)))
      .all();
    return c.json({
      month_usd: round(
        rows.reduce((sum, r) => sum + r.cost, 0),
        4,
      ),
      turns: rows.length,
      model: config.agent.model,
    });
  });

  api.get("/about", (c) => {
    const manifest = path.join(referenceDir, "manifest.json");
    return c.json({
      version: config.appVersion || null,
      reference: fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest, "utf8")) : {},
    });
  });
}
