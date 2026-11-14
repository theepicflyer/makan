/**
 * The per-turn context block and the compact one-line forms of foods and entries the agent reads.
 * Everything that changes between turns goes here, in the user message, never in the system prompt.
 */
import { type ContextArgs, type Db, localTime, type User } from "warren/server";
import { addDays, daysBetween, formatDay, g } from "../dates.js";
import * as foodSvc from "../foods.js";
import * as logSvc from "../log.js";
import { type Entry, type Food, MEALS } from "../schema.js";

const num = (value: number | null): string => (value === null ? "?" : value.toFixed(0));

function servingsText(food: Food): string {
  if (!food.servings.length) return "no servings (use grams)";
  return food.servings
    .map((s) => {
      const kcal = food.kcal === null ? null : (food.kcal * s.grams) / 100;
      return `${s.label}=${g(s.grams)}g (${num(kcal)} kcal)${s.default ? "*" : ""}`;
    })
    .join(", ");
}

export function foodLine(food: Food): string {
  const brand = food.brand ? ` (${food.brand})` : "";
  const aliases = food.aliases.length ? ` · aliases: ${food.aliases.join(", ")}` : "";
  return (
    `#${food.id} ${food.name}${brand} [${foodSvc.SOURCE_LABEL[food.source]}] ` +
    `${num(food.kcal)} kcal/100g, P${num(food.protein_g)} C${num(food.carb_g)} ` +
    `F${num(food.fat_g)} · servings: ${servingsText(food)}${aliases}`
  );
}

export function entryLine(entry: Entry): string {
  const portion = foodSvc.describePortion(entry.servings, entry.serving_label, entry.grams);
  return (
    `#${entry.id} ${entry.meal}: ${entry.name}${entry.is_estimate ? " (estimate)" : ""} — ` +
    `${portion || "portion n/a"} — ${num(entry.kcal)} kcal, ` +
    `P${num(entry.protein_g)} C${num(entry.carb_g)} F${num(entry.fat_g)}`
  );
}

export function totalLine(prefix: string, items: Entry[]): string {
  const t = logSvc.totals(items);
  return `${prefix}: ${num(t.kcal)} kcal, P${num(t.protein_g)} C${num(t.carb_g)} F${num(t.fat_g)}`;
}

export function dayLines(db: Db, user: User, day: string): string[] {
  const items = logSvc.entriesBetween(db, user, day, day);
  if (!items.length) return ["(nothing logged yet)"];
  const order = (e: Entry) => MEALS.indexOf(e.meal);
  items.sort((a, b) => order(a) - order(b) || a.position - b.position || a.id - b.id);
  return [...items.map(entryLine), totalLine("Total", items)];
}

function relative(day: string, today: string): string {
  const days = daysBetween(day, today);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days > 1) return `${days} days ago`;
  return days < -1 ? `${-days} days ahead` : "tomorrow";
}

export interface ContextOptions {
  now: Date;
  timezone: string;
  /** The day the app is showing. */
  logDate: string;
  includeFoods: boolean;
  includeFrequent: boolean;
}

export function buildContext(db: Db, user: User, options: ContextOptions): string {
  const { logDate } = options;
  const local = localTime(options.now, options.timezone);
  const today = local.date;
  const yesterday = addDays(today, -1);
  const time = `${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}`;
  const lines = [
    "<context>",
    `Today: ${formatDay(today)}, ${time} Singapore time.`,
    `Yesterday: ${formatDay(yesterday)}.`,
    `Log date (the day the app is showing): ${formatDay(logDate)}, ${relative(logDate, today)}.`,
  ];
  if (local.hour < 4) {
    lines.push(
      `It is just after midnight, so the user's "today" and "tonight" mean ${formatDay(yesterday)}.`,
    );
  }
  if (options.includeFoods) {
    const ours = foodSvc.oursFoods(db);
    lines.push("Household foods (Ours):");
    lines.push(...(ours.length ? ours.map((f) => `- ${foodLine(f)}`) : ["- (none yet)"]));
  }
  if (options.includeFrequent) {
    const frequent = logSvc.frequentItems(db, user, logDate);
    if (frequent.length) {
      lines.push("This user's frequent foods (food_id, usual portion):");
      for (const item of frequent) {
        const portion = foodSvc.describePortion(item.servings, item.serving_label, item.grams);
        lines.push(`- #${item.food_id} ${item.name} — ${portion}`);
      }
    }
  }
  for (const day of logDate === today ? [logDate] : [logDate, today]) {
    lines.push(`Entries on ${day} (${relative(day, today)}):`);
    lines.push(...dayLines(db, user, day).map((line) => `- ${line}`));
  }
  lines.push("</context>");
  return lines.join("\n");
}

/**
 * Warren's context hook. The household food list is long, so it is sent once per thread and again
 * only when it changes; the person's frequent foods go on the first turn.
 */
export function agentContext(timezone: string) {
  return ({ db, user, scope, now, firstTurn, state }: ContextArgs) => {
    const fingerprint = foodSvc.oursFingerprint(foodSvc.oursFoods(db));
    return {
      text: buildContext(db, user, {
        now,
        timezone,
        logDate: scope,
        includeFoods: state.foods !== fingerprint,
        includeFrequent: firstTurn,
      }),
      state: { foods: fingerprint },
    };
  };
}
