/**
 * Run the Bao agent over the eval cases and grade the resulting database state.
 *
 *   npm run evals -- --model claude-haiku-5-5 --effort low --reps 2
 *   npm run evals -- --model claude-opus-5-5 --effort low --tags text
 *   npm run evals -- --model claude-haiku-5-5 --effort low --no-cache --name haiku-low-nocache
 *   npm run evals -- --dry-run          # check and seed every case, no API calls
 *
 * Each (case, rep) gets its own copy of a template database with the reference foods loaded.
 * Results go to evals/results/<name>/: results.jsonl, errors.jsonl and traces/<case>_rep<k>.json.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  type AgentClient,
  type AgentConfig,
  type Db,
  DB_FILE,
  openDatabase,
  runMigrations,
  runTurn,
  saveImage,
  schema as warren,
  upsertUser,
  type User,
} from "warren/server";
import { baoAgent, MIGRATIONS } from "../src/app.js";
import { SYSTEM_PROMPT } from "../src/agent/systemPrompt.js";
import { instant, isDay } from "../src/dates.js";
import * as foodSvc from "../src/foods.js";
import * as logSvc from "../src/log.js";
import { type Entry, entries, type Food, foods } from "../src/schema.js";
import { BY_ID, CASES } from "./cases.js";
import { type Case, type EntrySpec, type FoodCheck, type Item, photosOf, type Range } from "./spec.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../evals");
export const RESULTS = path.join(ROOT, "results");
const PHOTOS = path.join(ROOT, "photos");
const REFERENCE = path.resolve(ROOT, "../data/reference");
const TZ = "Asia/Singapore";
const CASE_TIMEOUT_MS = 240_000;
const MACROS = ["kcal", "protein_g", "carb_g", "fat_g"] as const;

type Ours = Record<string, number>;
interface FirstTurn {
  ids: number[];
  total: number;
}

function open(dir: string): { db: Db; close(): void } {
  const database = openDatabase(path.join(dir, DB_FILE));
  return { db: database.db, close: () => database.sqlite.close() };
}

export function buildTemplate(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
  const database = openDatabase(path.join(dir, DB_FILE));
  runMigrations(database, [{ folder: MIGRATIONS, table: "bao_migrations" }]);
  foodSvc.loadReference(database.db, REFERENCE, { force: true });
  database.sqlite.pragma("wal_checkpoint(TRUNCATE)");
  database.sqlite.close();
}

function foodRef(db: Db, ref: string, ours: Ours): number {
  const split = ref.indexOf(":");
  const [kind, name] = [ref.slice(0, split), ref.slice(split + 1)];
  if (kind === "ours") return ours[name]!;
  const source = kind === "sg" ? "sgfoodid" : "usda";
  const found = db
    .select({ id: foods.id })
    .from(foods)
    .where(and(eq(foods.source, source), eq(foods.name, name)))
    .get();
  if (!found) throw new Error(`setup food not found: ${ref}`);
  return found.id;
}

function evalUser(db: Db): User {
  return upsertUser(db, { sub: "eval:user", email: "eval@example.com", name: "Jia" });
}

export function seed(db: Db, c: Case): { user: User; ours: Ours } {
  const user = evalUser(db);
  upsertUser(db, { sub: "eval:partner", email: "partner@example.com", name: "Partner" });
  const ours: Ours = {};
  for (const spec of c.ours) {
    ours[spec.key] = foodSvc.saveOurs(db, user.id, {
      name: spec.name,
      brand: spec.brand,
      nutrients: spec.nutrients,
      servings: spec.servings,
      aliases: spec.aliases,
    }).food.id;
  }
  for (const raw of c.entries) {
    const spec: EntrySpec = Array.isArray(raw) ? { date: raw[0], meal: raw[1], ref: raw[2], servings: raw[3] } : raw;
    logSvc.addEntry(db, user, {
      day: spec.date,
      meal: spec.meal,
      food_id: spec.ref ? foodRef(db, spec.ref, ours) : null,
      servings: spec.servings,
      serving: spec.serving,
      grams: spec.grams,
      name: spec.name,
      nutrients: spec.ref ? null : Object.fromEntries(MACROS.map((n) => [n, spec[n] ?? null])),
    });
  }
  return { user, ours };
}

// --- grading --------------------------------------------------------------------------------------

const within = (value: number | null | undefined, [lo, hi]: Range) => value != null && lo <= value && value <= hi;
const matches = (pattern: string, text: string) => new RegExp(pattern, "i").test(text);

function itemOk(item: Item, e: Entry, ours: Ours, logDate: string, firstIds: Set<number> | null): boolean {
  if (!matches(item.name, e.name)) return false;
  if (item.from_first_turn && firstIds && !firstIds.has(e.id)) return false;
  if (item.meal && e.meal !== item.meal) return false;
  if (e.date !== (item.date ?? logDate)) return false;
  if (item.kcal && !within(e.kcal, item.kcal)) return false;
  if (item.ours && e.food_id !== ours[item.ours]) return false;
  return !(item.not_ours && e.food_id === ours[item.not_ours]);
}

function foodProblems(check: FoodCheck, food: Food): string[] {
  const problems: string[] = [];
  for (const n of MACROS) {
    const bounds = check[n];
    if (bounds && !within(food[n], bounds)) problems.push(`${n}=${food[n]} not in ${JSON.stringify(bounds)}`);
  }
  if (check.serving_grams) {
    const grams = food.servings.map((s) => s.grams);
    if (!grams.some((g) => check.serving_grams!.some((b) => within(g, b)))) {
      problems.push(`servings ${JSON.stringify(grams)} miss ${JSON.stringify(check.serving_grams)}`);
    }
  }
  if (check.serving_kcal) {
    const serving = foodSvc.defaultServing(food);
    const kcal = serving && food.kcal !== null ? (food.kcal * serving.grams) / 100 : null;
    if (!within(kcal || null, check.serving_kcal)) {
      problems.push(`default serving ${(kcal ?? 0).toFixed(0)} kcal not in ${JSON.stringify(check.serving_kcal)}`);
    }
  }
  for (const a of check.aliases_include) {
    if (!food.aliases.includes(a)) problems.push(`alias '${a}' missing (has ${JSON.stringify([...food.aliases].sort())})`);
  }
  for (const a of check.aliases_exclude) {
    if (food.aliases.includes(a)) problems.push(`alias '${a}' should have moved`);
  }
  return problems;
}

/** Maximum matching of expected items to entries (Kuhn's algorithm). Returns item index -> entry index. */
function match<I, E>(items: I[], rows: E[], ok: (item: I, row: E) => boolean): Map<number, number> {
  const owner = new Map<number, number>();
  const assign = (i: number, seen: Set<number>): boolean => {
    for (let j = 0; j < rows.length; j++) {
      if (seen.has(j) || !ok(items[i]!, rows[j]!)) continue;
      seen.add(j);
      if (!owner.has(j) || assign(owner.get(j)!, seen)) {
        owner.set(j, i);
        return true;
      }
    }
    return false;
  };
  for (let i = 0; i < items.length; i++) assign(i, new Set());
  return new Map([...owner].map(([j, i]) => [i, j]));
}

type Block = Record<string, any>;
type Message = { role: string; content: string | Block[] };

function turnMessages(db: Db, userId: number): { messages: Message[]; rows: (typeof warren.turns.$inferSelect)[] } {
  const rows = db
    .select({ turn: warren.turns })
    .from(warren.turns)
    .innerJoin(warren.threads, eq(warren.turns.threadId, warren.threads.id))
    .where(eq(warren.threads.userId, userId))
    .orderBy(asc(warren.turns.id))
    .all()
    .map((r) => r.turn);
  return { rows, messages: rows.flatMap((t) => t.messages as Message[]) };
}

/** Tool calls made over the case, and the text of those that came back as errors. */
function toolStats(messages: Message[]): { calls: number; errors: string[] } {
  let calls = 0;
  const errors: string[] = [];
  for (const m of messages) {
    if (typeof m.content === "string") continue;
    for (const b of m.content) {
      if (b.type === "tool_use") calls += 1;
      else if (b.type === "tool_result" && b.is_error) {
        errors.push(typeof b.content === "string" ? b.content : JSON.stringify(b.content));
      }
    }
  }
  return { calls, errors };
}

export interface Grade {
  pass: number;
  items: number;
  kcal_err?: number;
}

export function grade(db: Db, c: Case, user: User, ours: Ours, reply: string, first: FirstTurn | null = null): { grade: Grade; failures: string[] } {
  const failures: string[] = [];
  const firstIds = first ? new Set(first.ids) : null;
  const rows = db
    .select()
    .from(entries)
    .where(and(eq(entries.user_id, user.id), inArray(entries.date, c.check_dates)))
    .orderBy(asc(entries.id))
    .all();
  const describe = (e: Entry) => `${e.date} ${e.meal} ${e.name} ${e.kcal}`;
  const ok = (item: Item, e: Entry) => itemOk(item, e, ours, c.log_date, firstIds);
  const required = (c.expect ?? []).filter((i) => !i.optional);
  // Bipartite matching, so an entry that fits two expectations can't starve the second.
  const pairs = match(required, rows, ok);
  required.forEach((item, idx) => {
    if (pairs.has(idx)) return;
    const near = rows.filter((e) => matches(item.name, e.name)).map(describe);
    failures.push(`missing ${item.meal} /${item.name}/ ${item.kcal ? JSON.stringify(item.kcal) : ""} (near: ${near.length ? JSON.stringify(near) : "none"})`);
  });
  const taken = new Set(pairs.values());
  const unmatched = rows.filter((_, j) => !taken.has(j));
  for (const item of (c.expect ?? []).filter((i) => i.optional)) {
    const at = unmatched.findIndex((e) => ok(item, e));
    if (at >= 0) unmatched.splice(at, 1);
  }
  if (c.expect !== null && c.strict_count) {
    failures.push(...unmatched.map((e) => `unexpected ${describe(e)}`));
  } else if (c.expect !== null) {
    const meals = new Set(c.expect.map((i) => i.meal));
    failures.push(
      ...unmatched.filter((e) => !meals.has(e.meal) && !meals.has(null)).map((e) => `unexpected ${e.date} ${e.meal} ${e.name}`),
    );
  }

  let foodChecks = 0;
  const household = foodSvc.oursFoods(db);
  for (const check of c.foods) {
    const candidates = household.filter(
      (f) => matches(check.name, `${f.brand ?? ""} ${f.name}`.trim()) || matches(check.name, f.name),
    );
    let best: string[] | null = null;
    for (const f of candidates) {
      const problems = foodProblems(check, f);
      if (!problems.length) {
        best = [];
        break;
      }
      if (best === null || problems.length < best.length) best = problems;
    }
    if (best === null) failures.push(`no household food /${check.name}/`);
    else if (best.length) failures.push(`food /${check.name}/: ${best.join("; ")}`);
    else foodChecks += 1;
  }

  const totalDate = c.total_date ?? c.log_date;
  const dayRows = rows.filter((e) => e.date === totalDate);
  const total = dayRows.filter((e) => c.total_meal === null || e.meal === c.total_meal).reduce((s, e) => s + (e.kcal ?? 0), 0);
  if (c.total_kcal && !within(total, c.total_kcal)) {
    failures.push(`day total ${total.toFixed(0)} kcal not in ${JSON.stringify(c.total_kcal)}`);
  }
  for (const pattern of c.forbid) {
    failures.push(...rows.filter((e) => matches(pattern, e.name)).map((e) => `should be gone: ${e.date} ${e.meal} ${e.name}`));
  }
  if (c.total_drop && first) {
    const drop = first.total - total;
    if (!within(drop, c.total_drop)) failures.push(`day total fell ${drop.toFixed(0)} kcal, expected ${JSON.stringify(c.total_drop)}`);
  }
  if (c.reply_protein) {
    const protein = dayRows.reduce((s, e) => s + (e.protein_g ?? 0), 0);
    const numbers = (reply.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
    if (!numbers.some((n) => Math.abs(n - protein) <= 3)) failures.push(`reply doesn't state protein ≈${protein.toFixed(0)} g`);
  }
  for (const pattern of c.reply_forbid) {
    if (matches(pattern, reply)) failures.push(`reply matches /${pattern}/`);
  }
  if (c.max_tool_calls !== null || c.max_tool_errors !== null) {
    const { calls, errors } = toolStats(turnMessages(db, user.id).messages);
    if (c.max_tool_calls !== null && calls > c.max_tool_calls) failures.push(`${calls} tool calls, max ${c.max_tool_calls}`);
    if (c.max_tool_errors !== null && errors.length > c.max_tool_errors) {
      failures.push(`tool errors: ${errors.map((e) => e.slice(0, 80)).join("; ")}`);
    }
  }

  const checks = required.length + c.foods.length;
  const score = checks ? (pairs.size + foodChecks) / checks : failures.length ? 0 : 1;
  const out: Grade = { pass: failures.length ? 0 : 1, items: Math.round(score * 1000) / 1000 };
  if (c.ref_kcal) out.kcal_err = Math.round((Math.abs(total - c.ref_kcal) / c.ref_kcal) * 1000) / 1000;
  return { grade: out, failures };
}

// --- one case -------------------------------------------------------------------------------------

/** The conversation as a flat, readable list, for looking at what the model did. */
function trace(messages: Message[]): Block[] {
  const out: Block[] = [{ role: "system", content: SYSTEM_PROMPT }];
  for (const m of messages) {
    if (typeof m.content === "string") {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    let thinking: string | null = null;
    const withThinking = () => {
      const extra = thinking ? { thinking } : {};
      thinking = null;
      return extra;
    };
    for (const b of m.content) {
      if (b.type === "text") out.push({ role: m.role, content: b.text, ...withThinking() });
      else if (b.type === "image") out.push({ role: "user", content: "[photo]" });
      else if (b.type === "thinking") thinking = b.thinking || null;
      else if (b.type === "tool_use") out.push({ role: "tool_call", name: b.name, content: JSON.stringify(b.input, null, 2), ...withThinking() });
      else if (b.type === "tool_result") out.push({ role: "tool_result", content: typeof b.content === "string" ? b.content : JSON.stringify(b.content) });
    }
  }
  return out;
}

const caseDir = (out: string, id: string, rep: number) => path.join(out, "dbs", `${id}_rep${rep}`);

async function runCase(c: Case, rep: number, config: AgentConfig, template: string, out: string, client: AgentClient) {
  const dir = caseDir(out, c.id, rep);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(template, dir, { recursive: true });
  const { db, close } = open(dir);
  try {
    const { user, ours } = seed(db, c);
    const [day, time] = c.now.split("T") as [string, string];
    const now = instant(day, Number(time.slice(0, 2)), Number(time.slice(3, 5)), TZ);
    const deps = { db, dataDir: dir, agent: baoAgent(TZ), config, client };
    const start = performance.now();
    let reply = "";
    const timings: Record<string, number>[] = [];
    let first: FirstTurn | null = null;
    let threadId: number | null = null;
    for (const [index, msg] of c.msgs.entries()) {
      const fileIds: number[] = [];
      for (const name of photosOf(msg)) {
        fileIds.push((await saveImage(db, dir, { userId: user.id, data: fs.readFileSync(path.join(PHOTOS, name)) })).id);
      }
      const timing: Record<string, number> = { turn: index };
      const turnStart = performance.now();
      for await (const event of runTurn(deps, { userId: user.id, scope: c.log_date, text: msg.text, fileIds, threadId, now })) {
        const elapsed = Math.round((performance.now() - turnStart) / 10) / 100;
        if (event.type === "turn") threadId = event.thread_id;
        if (event.type === "changed") timing.changed_s ??= elapsed;
        if (event.type === "text") timing.first_text_s ??= elapsed;
        if (event.type === "error") throw new Error(event.message);
        if (event.type === "done") {
          timing.done_s = elapsed;
          reply = event.turn.reply_text;
          if (event.turn.status !== "ok") throw new Error(`turn status ${event.turn.status}`);
        }
      }
      timings.push(timing);
      if (index === 0 && c.msgs.length > 1) {
        const all = db.select().from(entries).where(eq(entries.user_id, user.id)).all();
        first = {
          ids: all.map((e) => e.id),
          total: all.filter((e) => e.date === c.log_date).reduce((s, e) => s + (e.kcal ?? 0), 0),
        };
      }
    }
    const latency = (performance.now() - start) / 1000;

    const { rows, messages } = turnMessages(db, user.id);
    const usage = { input: 0, output: 0, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0, calls: 0 };
    const models = new Set<string>();
    for (const t of rows) {
      for (const k of Object.keys(usage) as (keyof typeof usage)[]) usage[k] += Number(t.usage[k] ?? 0);
      if (t.usage.model) models.add(String(t.usage.model));
    }
    const { grade: g, failures } = grade(db, c, user, ours, reply, first);
    const model = models.size === 1 ? [...models][0]! : [...models].sort().join(",");
    if (model !== config.model) {
      failures.push(`served by ${model}, requested ${config.model}`);
      g.pass = 0;
    }
    fs.writeFileSync(path.join(out, "traces", `${c.id}_rep${rep}.json`), JSON.stringify(trace(messages), null, 1));
    return {
      prompt_id: c.id,
      rep,
      prompt: c.msgs.map((m) => m.text || `[photo ${photosOf(m).join(", ")}]`).join(" ⏎ "),
      tags: c.tags,
      status: "ok",
      grade: g,
      failures,
      reply,
      model,
      effort: config.effort,
      cache: config.cache,
      usage: {
        input_tokens: usage.input,
        output_tokens: usage.output,
        cache_read_input_tokens: usage.cache_read,
        cache_creation_input_tokens: usage.cache_write_5m + usage.cache_write_1h,
      },
      api_calls: usage.calls,
      tool_calls: toolStats(messages).calls,
      latency_s: Math.round(latency * 100) / 100,
      turns: timings,
      first_turn: first,
      cost_usd: Math.round(rows.reduce((s, t) => s + t.costUsd, 0) * 1e6) / 1e6,
    };
  } finally {
    close();
  }
}

const missingPhotos = (c: Case) => c.msgs.flatMap(photosOf).filter((n) => !fs.existsSync(path.join(PHOTOS, n)));

/** Problems with a case definition that would make its result meaningless. */
export function check(c: Case): string[] {
  const problems = missingPhotos(c).map((n) => `missing photo ${path.join(PHOTOS, n)}`);
  const patterns = [...(c.expect ?? []).map((i) => i.name), ...c.foods.map((f) => f.name), ...c.forbid, ...c.reply_forbid];
  for (const pattern of patterns) {
    try {
      new RegExp(pattern, "i");
    } catch (err) {
      problems.push(`bad regex /${pattern}/: ${(err as Error).message}`);
    }
  }
  for (const d of [c.log_date, c.now.slice(0, 10), ...c.check_dates]) {
    if (!isDay(d)) problems.push(`bad date ${d}`);
  }
  const keys = new Set(c.ours.map((spec) => spec.key));
  for (const item of c.expect ?? []) {
    if (!c.check_dates.includes(item.date ?? c.log_date)) problems.push(`/${item.name}/ expects ${item.date ?? c.log_date}, not checked`);
    if (![null, "breakfast", "lunch", "dinner", "snacks"].includes(item.meal)) problems.push(`/${item.name}/ has meal ${item.meal}`);
    for (const key of [item.ours, item.not_ours]) {
      if (key && !keys.has(key)) problems.push(`/${item.name}/ names unknown household food ${key}`);
    }
  }
  if (c.total_kcal && !c.check_dates.includes(c.total_date ?? c.log_date)) problems.push("total_kcal date is not in check_dates");
  if (c.total_drop && (c.total_meal || c.total_date)) problems.push("total_drop compares whole log-date totals; drop total_meal/total_date");
  return problems;
}

/** Check each case and seed it into a scratch database, without calling the API. */
export function dryRun(cases: Case[], template: string): number {
  const scratch = path.join(RESULTS, "_dry_run");
  let bad = 0;
  for (const c of cases) {
    const problems = check(c);
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.cpSync(template, scratch, { recursive: true });
    const { db, close } = open(scratch);
    try {
      const { user, ours } = seed(db, c);
      grade(db, c, user, ours, "");
    } catch (err) {
      problems.push(`seed/grade failed: ${(err as Error).name}: ${(err as Error).message}`);
    } finally {
      close();
    }
    if (problems.length) bad += 1;
    console.error(`  ${problems.length ? "BAD" : "ok "} ${c.id} ${problems.join("; ")}`);
  }
  fs.rmSync(scratch, { recursive: true, force: true });
  console.error(`${cases.length} cases, ${bad} with problems`);
  return bad;
}

/** Re-grade every finished row from its saved database, after a grader fix. */
function regrade(out: string): void {
  const file = path.join(out, "results.jsonl");
  const rows = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  for (const row of rows) {
    const c = BY_ID.get(row.prompt_id)!;
    const { db, close } = open(caseDir(out, c.id, row.rep));
    try {
      const ids = foodSvc.oursFoods(db).map((f) => f.id).sort((a, b) => a - b);
      const ours = Object.fromEntries(c.ours.map((spec, i) => [spec.key, ids[i]!]));
      const result = grade(db, c, evalUser(db), ours, row.reply, row.first_turn);
      [row.grade, row.failures] = [result.grade, result.failures];
    } finally {
      close();
    }
  }
  fs.writeFileSync(file, rows.map((r) => `${JSON.stringify(r)}\n`).join(""));
  console.error(`regraded ${rows.length} rows in ${file}`);
}

async function main(): Promise<void> {
  const { values: args } = parseArgs({
    options: {
      model: { type: "string", default: "claude-haiku-5-5" },
      effort: { type: "string", default: "low" },
      reps: { type: "string", default: "1" },
      tags: { type: "string", default: "" }, // comma list; a case runs if it has any of them
      cases: { type: "string", default: "" }, // comma list of case ids
      "no-cache": { type: "boolean", default: false },
      "cache-ttl": { type: "string", default: "5m" },
      concurrency: { type: "string", default: "6" },
      name: { type: "string" },
      regrade: { type: "boolean", default: false }, // re-grade saved results, no API calls
      "dry-run": { type: "boolean", default: false }, // check and seed cases, no API calls
    },
  });
  const config: AgentConfig = {
    model: args.model,
    effort: args.effort as AgentConfig["effort"],
    maxTokens: 16000,
    cache: !args["no-cache"],
    cacheTtl: args["cache-ttl"] as AgentConfig["cacheTtl"],
    maxIterations: 8,
  };
  const name = args.name ?? `${args.model.replace(/^claude-/, "")}-${args.effort}${args["no-cache"] ? "-nocache" : ""}`;
  const out = path.join(RESULTS, name);
  if (args.regrade) return regrade(out);

  let cases = CASES;
  if (args.cases) {
    const wanted = new Set(args.cases.split(","));
    const unknown = [...wanted].filter((id) => !BY_ID.has(id));
    if (unknown.length) throw new Error(`unknown case ids: ${unknown.sort().join(", ")}`);
    cases = cases.filter((c) => wanted.has(c.id));
  }
  if (args.tags) {
    const tags = new Set(args.tags.split(","));
    cases = cases.filter((c) => c.tags.some((t) => tags.has(t)));
  }

  const template = path.join(RESULTS, "_template");
  if (!fs.existsSync(path.join(template, DB_FILE))) buildTemplate(template);
  if (args["dry-run"]) process.exit(dryRun(cases, template) ? 1 : 0);

  const missing = cases.flatMap(missingPhotos);
  if (missing.length) throw new Error(`missing photos in ${PHOTOS}: ${missing.join(", ")}`);
  fs.mkdirSync(path.join(out, "traces"), { recursive: true });
  fs.mkdirSync(path.join(out, "dbs"), { recursive: true });
  fs.writeFileSync(path.join(out, "config.json"), JSON.stringify(config, null, 1));

  const resultsFile = path.join(out, "results.jsonl");
  const done = new Set<string>();
  if (fs.existsSync(resultsFile)) {
    for (const line of fs.readFileSync(resultsFile, "utf8").split("\n").filter(Boolean)) {
      const row = JSON.parse(line);
      done.add(`${row.prompt_id}#${row.rep}`);
    }
  }
  const todo = cases.flatMap((c) => Array.from({ length: Number(args.reps) }, (_, r) => [c, r] as const)).filter(([c, r]) => !done.has(`${c.id}#${r}`));
  console.error(`${name}: ${todo.length} runs (${done.size} already done)`);

  const client = new Anthropic({ maxRetries: 4 }) as unknown as AgentClient;
  const one = async (c: Case, rep: number) => {
    await new Promise((r) => setTimeout(r, Math.random() * 500));
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error("timed out"), { name: "timeout" })), CASE_TIMEOUT_MS);
      });
      const row = await Promise.race([runCase(c, rep, config, template, out, client), timeout]);
      fs.appendFileSync(resultsFile, `${JSON.stringify(row)}\n`);
      console.error(`  ${row.grade.pass ? "PASS" : "FAIL"} ${c.id}#${rep} $${row.cost_usd.toFixed(4)} ${row.latency_s}s ${row.failures.join("; ").slice(0, 300)}`);
    } catch (err) {
      const e = err as Error;
      fs.appendFileSync(path.join(out, "errors.jsonl"), `${JSON.stringify({ prompt_id: c.id, rep, class: e.name, message: e.message.slice(0, 500) })}\n`);
      console.error(`  ERROR ${c.id}#${rep} ${e.name}: ${e.message.slice(0, 200)}`);
    } finally {
      clearTimeout(timer);
    }
  };
  const queue = [...todo];
  await Promise.all(
    Array.from({ length: Number(args.concurrency) }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) await one(...next);
    }),
  );
  console.error(`wrote ${resultsFile}`);
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) await main();
