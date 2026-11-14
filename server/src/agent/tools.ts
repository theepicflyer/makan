/**
 * Bao's tools. The first seven are the in-app agent's: they return compact text, which costs
 * fewer tokens than JSON. The rest are read-only tools for MCP clients (an analysis agent on
 * claude.ai), which return data.
 */
import { inArray } from "drizzle-orm";
import { defineTool, DomainError, type Tool, type ToolContext } from "warren/server";
import { z } from "zod";
import { daysBetween, logDay, parseDay, round } from "../dates.js";
import * as foodSvc from "../foods.js";
import * as logSvc from "../log.js";
import { type Food, foods, MEALS, NUTRIENTS, type Nutrients, nutrientsOf } from "../schema.js";
import { dayLines, entryLine, foodLine, totalLine } from "./context.js";

// --- the agent's tools ----------------------------------------------------------------------------

const meal = z.enum(MEALS);
const portion = {
  servings: z.number().positive().optional().describe("How many of `serving`. Defaults to 1."),
  serving: z
    .string()
    .optional()
    .describe("A serving label of the food, e.g. 'bowl', 'slice', 'cup'. Omit for the default serving."),
  grams: z
    .number()
    .positive()
    .optional()
    .describe(
      "Total weight eaten; use instead of servings when the user gives a weight or you judge it " +
        "from a photo. With an estimate, the weight its numbers are for.",
    ),
};
const custom = {
  name: z
    .string()
    .optional()
    .describe("Required when there is no food_id; overrides the display name otherwise."),
  kcal: z.number().min(0).optional().describe("Total kcal for a custom estimate (no food_id)."),
  protein_g: z.number().min(0).optional(),
  carb_g: z.number().min(0).optional(),
  fat_g: z.number().min(0).optional(),
  note: z.string().optional(),
};

const NewEntry = z.strictObject({
  meal,
  date: z.string().optional().describe("YYYY-MM-DD. Defaults to the log date."),
  food_id: z.number().int().optional(),
  ...portion,
  ...custom,
  photo: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Which attached photo the item is from (1 = first), when the message has several."),
});

const EntryChange = z.strictObject({
  entry_id: z.number().int(),
  meal: meal.optional(),
  date: z.string().optional().describe("YYYY-MM-DD"),
  food_id: z.number().int().optional(),
  ...portion,
  ...custom,
});

const FoodNutrients = z.strictObject({
  basis: z.enum(["per_100g", "per_serving"]).default("per_100g"),
  serving_grams: z.number().positive().optional().describe("Required when basis is per_serving."),
  kcal: z.number().min(0),
  protein_g: z.number().min(0).optional(),
  carb_g: z.number().min(0).optional(),
  fat_g: z.number().min(0).optional(),
  fibre_g: z.number().min(0).optional(),
  sugar_g: z.number().min(0).optional(),
  sodium_mg: z.number().min(0).optional(),
  sat_fat_g: z.number().min(0).optional(),
});

function dayOf(value: string | undefined, ctx: ToolContext): string {
  return value === undefined ? ctx.scope! : parseDay(value);
}

/** The photo an entry came from: the one it names, or the only one sent. */
function photoOf(ctx: ToolContext, number: number | undefined): number | null {
  if (number !== undefined && number <= ctx.fileIds.length) return ctx.fileIds[number - 1]!;
  return ctx.fileIds.length === 1 ? ctx.fileIds[0]! : null;
}

function estimate(item: { kcal?: number; protein_g?: number; carb_g?: number; fat_g?: number }) {
  const values = { kcal: item.kcal, protein_g: item.protein_g, carb_g: item.carb_g, fat_g: item.fat_g };
  return Object.values(values).every((v) => v === undefined) ? null : values;
}

function daySummary(ctx: ToolContext, days: Set<string>): string[] {
  return [...days].sort().map((day) => totalLine(`Day total ${day}`, logSvc.entriesBetween(ctx.db, ctx.user, day, day)));
}

/** One item of a batch: its own savepoint, so a bad item doesn't undo the good ones. */
function each<T>(ctx: ToolContext, fn: () => T): T {
  return ctx.db.transaction(() => fn());
}

function perHundred(n: z.infer<typeof FoodNutrients>): Partial<Nutrients> {
  const values = Object.fromEntries(NUTRIENTS.filter((k) => n[k] !== undefined).map((k) => [k, n[k]!]));
  if (n.basis === "per_100g") return values;
  if (!n.serving_grams) throw new DomainError("basis per_serving needs serving_grams");
  const factor = 100 / n.serving_grams;
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, round(v * factor, 2)]));
}

const agentTools: Tool[] = [
  defineTool({
    name: "search_foods",
    description:
      "Search the food database (Ours, SG FoodID, USDA) for several items at once. " +
      "Returns the best matches per query with food_id, kcal and macros per 100 g, and servings " +
      "(* marks the default).",
    input: z.strictObject({
      queries: z.array(z.string()).min(1).max(15).describe("One short food name per item."),
      limit: z.number().int().min(1).max(10).default(5).describe("Matches per query, default 5."),
    }),
    writes: false,
    expose: ["agent"],
    run(ctx, args) {
      const out: string[] = [];
      for (const q of args.queries) {
        const hits = foodSvc.search(ctx.db, q, args.limit);
        out.push(`"${q}":`);
        if (!hits.length) out.push("  (no matches)");
        for (const h of hits) {
          out.push(`  ${foodLine(h.food)}${h.alias_match ? ` · "${q}" is a known name for this food` : ""}`);
        }
      }
      return out.join("\n");
    },
  }),

  defineTool({
    name: "get_entries",
    description: "List one day's log entries (with ids) and totals.",
    input: z.strictObject({ date: z.string().describe("YYYY-MM-DD") }),
    writes: false,
    expose: ["agent"],
    run(ctx, args) {
      const day = parseDay(args.date);
      return `Entries on ${day}:\n${dayLines(ctx.db, ctx.user, day).join("\n")}`;
    },
  }),

  defineTool({
    name: "log_entries",
    description:
      "Add items to the log. Each item has a meal and either a food_id (with an optional portion) " +
      "or a name plus kcal/protein_g/carb_g/fat_g for a custom estimate.",
    input: z.strictObject({ entries: z.array(NewEntry).min(1).max(30) }),
    writes: true,
    expose: ["agent"],
    run(ctx, args) {
      const lines: string[] = [];
      const errors: string[] = [];
      const days = new Set<string>();
      args.entries.forEach((item, i) => {
        try {
          const entry = each(ctx, () =>
            logSvc.addEntry(
              ctx.db,
              ctx.user,
              {
                day: dayOf(item.date, ctx),
                meal: item.meal,
                food_id: item.food_id,
                servings: item.servings,
                serving: item.serving,
                grams: item.grams,
                name: item.name,
                nutrients: estimate(item),
                note: item.note,
                photo_id: photoOf(ctx, item.photo),
                origin: "agent",
              },
              ctx.changes,
            ),
          );
          lines.push(`Logged ${entry.date} ${entryLine(entry)}`);
          days.add(entry.date);
        } catch (err) {
          if (!(err instanceof DomainError)) throw err;
          errors.push(`item ${i + 1}: ${err.message}`);
        }
      });
      for (const day of days) ctx.touched.add(day);
      return [...lines, ...errors.map((e) => `Not logged — ${e}`), ...daySummary(ctx, days)].join("\n");
    },
  }),

  defineTool({
    name: "update_entries",
    description:
      "Change existing entries: move to another meal or date, change the portion (servings alone keeps " +
      "the current serving), swap the food, or set custom nutrient totals. Only pass fields that change.",
    input: z.strictObject({ updates: z.array(EntryChange).min(1).max(30) }),
    writes: true,
    expose: ["agent"],
    run(ctx, args) {
      const lines: string[] = [];
      const errors: string[] = [];
      const days = new Set<string>();
      for (const u of args.updates) {
        try {
          const before = logSvc.getEntry(ctx.db, ctx.user, u.entry_id);
          const entry = each(ctx, () =>
            logSvc.updateEntry(
              ctx.db,
              ctx.user,
              u.entry_id,
              {
                day: u.date === undefined ? null : parseDay(u.date),
                meal: u.meal,
                food_id: u.food_id,
                servings: u.servings,
                serving: u.serving,
                grams: u.grams,
                name: u.name,
                nutrients: estimate(u),
                note: u.note,
              },
              { changes: ctx.changes },
            ),
          );
          lines.push(`Updated ${entry.date} ${entryLine(entry)}`);
          days.add(before.date).add(entry.date);
        } catch (err) {
          if (!(err instanceof DomainError)) throw err;
          errors.push(`#${u.entry_id}: ${err.message}`);
        }
      }
      for (const day of days) ctx.touched.add(day);
      return [...lines, ...errors.map((e) => `Not updated — ${e}`), ...daySummary(ctx, days)].join("\n");
    },
  }),

  defineTool({
    name: "delete_entries",
    description: "Remove entries from the log.",
    input: z.strictObject({ entry_ids: z.array(z.number().int()).min(1).max(30) }),
    writes: true,
    expose: ["agent"],
    run(ctx, args) {
      const lines: string[] = [];
      const errors: string[] = [];
      const days = new Set<string>();
      for (const id of args.entry_ids) {
        try {
          const gone = each(ctx, () => logSvc.deleteEntry(ctx.db, ctx.user, id, { changes: ctx.changes }));
          lines.push(`Deleted #${id} ${gone.name}`);
          days.add(gone.date);
        } catch (err) {
          if (!(err instanceof DomainError)) throw err;
          errors.push(err.message);
        }
      }
      for (const day of days) ctx.touched.add(day);
      return [...lines, ...errors.map((e) => `Not deleted — ${e}`), ...daySummary(ctx, days)].join("\n");
    },
  }),

  defineTool({
    name: "save_food",
    description:
      "Create a household (Ours) food, or edit one by food_id. On edit, only pass what changes: " +
      "`servings` adds or updates servings by label, `aliases` adds aliases (an alias moves off any " +
      "other household food). Nutrients are per 100 g unless basis is per_serving.",
    input: z.strictObject({
      food_id: z.number().int().optional().describe("Omit to create a new food."),
      name: z.string().optional(),
      brand: z.string().optional(),
      nutrients: FoodNutrients.optional(),
      servings: z
        .array(z.strictObject({ label: z.string(), grams: z.number().positive(), default: z.boolean().default(false) }))
        .optional(),
      remove_servings: z.array(z.string()).optional(),
      aliases: z.array(z.string()).optional(),
      remove_aliases: z.array(z.string()).optional(),
    }),
    writes: true,
    expose: ["agent"],
    run(ctx, args) {
      const nutrients = args.nutrients ? perHundred(args.nutrients) : null;
      let servings: { label: string; grams: number; default?: boolean }[] | null = null;
      let aliases: string[] | null = null;
      if (args.food_id !== undefined) {
        const current = foodSvc.getFood(ctx.db, args.food_id);
        if (args.servings || args.remove_servings?.length) {
          const byLabel = new Map(current.servings.map((s) => [foodSvc.normalizeLabel(s.label), { ...s }]));
          for (const label of args.remove_servings ?? []) byLabel.delete(foodSvc.normalizeLabel(label));
          for (const s of args.servings ?? []) {
            if (s.default) for (const existing of byLabel.values()) existing.default = false;
            const key = foodSvc.normalizeLabel(s.label);
            byLabel.set(key, { label: s.label, grams: s.grams, default: s.default || Boolean(byLabel.get(key)?.default) });
          }
          servings = [...byLabel.values()];
        }
        if (args.aliases || args.remove_aliases?.length) {
          const drop = new Set((args.remove_aliases ?? []).map((a) => a.trim().toLowerCase()));
          aliases = [...current.aliases.filter((a) => !drop.has(a)), ...(args.aliases ?? [])];
        }
      } else {
        servings = args.servings ?? [];
        if (args.nutrients?.basis === "per_serving" && !servings.length) {
          servings = [{ label: "serving", grams: args.nutrients.serving_grams!, default: true }];
        }
        aliases = args.aliases ?? [];
      }
      const { food, created } = foodSvc.saveOurs(
        ctx.db,
        ctx.user.id,
        { food_id: args.food_id, name: args.name, brand: args.brand, nutrients, servings, aliases },
        ctx.changes,
      );
      return `${created ? "Created" : "Updated"} ${foodLine(food)}`;
    },
  }),

  defineTool({
    name: "delete_food",
    description: "Delete a household (Ours) food. Past log entries keep their values.",
    input: z.strictObject({ food_id: z.number().int() }),
    writes: true,
    expose: ["agent"],
    run(ctx, args) {
      const food = foodSvc.deleteOurs(ctx.db, args.food_id, ctx.changes);
      return `Deleted household food #${food.id} ${food.name}`;
    },
  }),
];

// --- tools for MCP clients ------------------------------------------------------------------------

export const MCP_INSTRUCTIONS =
  "Read-only access to one person's food log from Bao, a calorie and macro tracker used in " +
  "Singapore. Entries are grouped by date and meal (breakfast, lunch, dinner, snacks). Nutrients are " +
  "totals for the portion eaten: kcal, protein_g, carb_g, fat_g, fibre_g, sugar_g, sodium_mg, " +
  "sat_fat_g (null when the source food has no value). A day with zero entries means nothing was " +
  "logged, not that nothing was eaten. Entries marked is_estimate were estimated (often from a photo) " +
  "rather than taken from a database food. Start with get_profile for targets, then get_daily_totals " +
  "for trends and get_food_log for detail.";

const MAX_RANGE_DAYS = 400;

const range = z.strictObject({
  start_date: z.string().describe("First day, YYYY-MM-DD"),
  end_date: z.string().describe("Last day (inclusive), YYYY-MM-DD"),
});

function checkRange(args: z.infer<typeof range>): [string, string] {
  let start: string;
  let end: string;
  try {
    [start, end] = [parseDay(args.start_date), parseDay(args.end_date)];
  } catch {
    throw new DomainError("Dates must be YYYY-MM-DD");
  }
  if (end < start) throw new DomainError("end_date is before start_date");
  if (daysBetween(start, end) >= MAX_RANGE_DAYS) {
    throw new DomainError(`Ask for at most ${MAX_RANGE_DAYS} days at a time`);
  }
  return [start, end];
}

const rounded = (values: Nutrients): Nutrients =>
  Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v === null ? null : round(v, 1)])) as Nutrients;

function foodOut(food: Food) {
  return {
    food_id: food.id,
    name: food.name,
    brand: food.brand,
    source: foodSvc.SOURCE_LABEL[food.source],
    per_100g: rounded(nutrientsOf(food)),
    servings: food.servings,
    aliases: food.aliases,
  };
}

function mcpTools(timezone: string): Tool[] {
  return [
    defineTool({
      name: "get_profile",
      description: "The signed-in person's name, daily targets, timezone and today's date.",
      input: z.strictObject({}),
      writes: false,
      expose: ["mcp"],
      run: (ctx) => ({
        name: ctx.user.name,
        targets_per_day: logSvc.targets(ctx.db, ctx.user),
        timezone,
        today: logDay(ctx.now, timezone),
        nutrients: [...NUTRIENTS],
        meals: [...MEALS],
      }),
    }),

    defineTool({
      name: "get_daily_totals",
      description:
        "Nutrient totals for each day in a range, with the person's targets. Days with entries=0 weren't logged.",
      input: range,
      writes: false,
      expose: ["mcp"],
      run(ctx, args) {
        const [start, end] = checkRange(args);
        return {
          targets_per_day: logSvc.targets(ctx.db, ctx.user),
          days: logSvc.dailyTotals(ctx.db, ctx.user, start, end),
        };
      },
    }),

    defineTool({
      name: "get_food_log",
      description: "Every logged item in a date range, grouped by date and meal, with per-item nutrients.",
      input: range,
      writes: false,
      expose: ["mcp"],
      run(ctx, args) {
        const [start, end] = checkRange(args);
        const items = logSvc.entriesBetween(ctx.db, ctx.user, start, end);
        const ids = [...new Set(items.flatMap((e) => (e.food_id === null ? [] : [e.food_id])))];
        const sources = new Map(
          ids.length
            ? ctx.db
                .select({ id: foods.id, source: foods.source })
                .from(foods)
                .where(inArray(foods.id, ids))
                .all()
                .map((f) => [f.id, f.source])
            : [],
        );
        const days: Record<string, Record<string, unknown[]>> = {};
        for (const e of items) {
          const meals = (days[e.date] ??= Object.fromEntries(MEALS.map((m) => [m, []])));
          const source = e.food_id === null ? undefined : sources.get(e.food_id);
          (meals[e.meal] ??= []).push({
            name: e.name,
            portion: foodSvc.describePortion(e.servings, e.serving_label, e.grams),
            grams: e.grams,
            is_estimate: e.is_estimate,
            source: source ? foodSvc.SOURCE_LABEL[source] : "custom",
            note: e.note,
            ...rounded(nutrientsOf(e)),
          });
        }
        return { days };
      },
    }),

    defineTool({
      // The agent has its own search_foods (several queries, compact text); MCP clients see this one.
      name: "search_foods",
      description:
        "Search the shared food database (household foods, SG FoodID, USDA). Nutrients are per 100 g.",
      input: z.strictObject({
        query: z.string().describe("Food name, e.g. 'laksa' or 'greek yogurt'"),
        limit: z.number().int().min(1).max(25).default(10),
      }),
      writes: false,
      expose: ["mcp"],
      run: (ctx, args) => ({
        results: foodSvc.search(ctx.db, args.query, args.limit).map((h) => foodOut(h.food)),
      }),
    }),

    defineTool({
      name: "list_household_foods",
      description: "The household's own foods (packaged items and usual orders), with servings and aliases.",
      input: z.strictObject({}),
      writes: false,
      expose: ["mcp"],
      run: (ctx) => ({ foods: foodSvc.oursFoods(ctx.db).map(foodOut) }),
    }),
  ];
}

export function baoTools(timezone: string): Tool[] {
  return [...agentTools, ...mcpTools(timezone)];
}

/** What the web app shows under a reply for each thing the agent changed. */
export function describeChange(change: { table: string; row: Record<string, unknown> }) {
  const { row } = change;
  const kcal = typeof row.kcal === "number" ? row.kcal : null;
  if (change.table !== "foods") return { name: row.name, kcal };
  // A food's calories per its default serving (else per 100 g) and its aliases.
  const parse = <T>(value: unknown, fallback: T): T =>
    typeof value === "string" ? (JSON.parse(value) as T) : ((value as T | undefined) ?? fallback);
  const servings = parse<{ label: string; grams: number; default?: boolean }[]>(row.servings, []);
  const aliases = parse<string[]>(row.aliases, []);
  const serving = servings.find((s) => s.default);
  if (!serving) return { name: row.name, serving: "100 g", kcal, aliases };
  return { name: row.name, serving: serving.label, kcal: kcal === null ? null : (kcal * serving.grams) / 100, aliases };
}
