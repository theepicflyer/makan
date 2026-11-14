/** Food lookup, search, portions, and the editable household ("ours") list. */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { type ChangeLog, type Db, DomainError, getMeta, noChanges, setMeta } from "warren/server";
import { g, round } from "./dates.js";
import { entries, type Food, foods, NUTRIENTS, type Nutrients, type Serving, type Source } from "./schema.js";

export const SOURCE_BOOST: Record<Source, number> = { ours: 12, sgfoodid: 2, usda: 0 };
export const SOURCE_LABEL: Record<Source, string> = { ours: "Ours", sgfoodid: "SG FoodID", usda: "USDA" };

const TOKEN = /[\p{L}\p{N}_']+/gu;

function tokens(text: string): string[] {
  return (text.match(TOKEN) ?? []).map((t) => t.toLowerCase());
}

// --- search ---------------------------------------------------------------------------------------
// The full-text index (food_fts) is kept by triggers on `foods`; see the first migration.

function ftsQuery(q: string, mode: "and" | "or"): string | null {
  const words = tokens(q).filter((t) => t.replace(/^'+|'+$/g, ""));
  if (!words.length) return null;
  return words.map((t) => `"${t.replaceAll('"', "")}"*`).join(mode === "and" ? " AND " : " OR ");
}

/** Spelling variants seen in hawker orders, tried as alternative queries. */
const VARIANTS: [RegExp, string][] = [
  [/\bbee hoon\b/g, "beehoon"],
  [/\bsiew\b/g, "siu"],
  [/\bkachang\b/g, "kacang"],
  [/\bk(?:ue|oa)y teow\b/g, "kway teow"],
  [/\bwonton\b/g, "wanton"],
];

export function queryVariants(q: string): string[] {
  const base = tokens(q).join(" ");
  const variants = [base];
  let alt = base;
  for (const [pattern, replacement] of VARIANTS) alt = alt.replace(pattern, replacement);
  if (alt.split(" ").includes("peng")) {
    alt = `iced ${alt
      .split(" ")
      .filter((t) => t !== "peng")
      .join(" ")}`;
  }
  if (alt !== base) variants.push(alt);
  // Plurals ("eggs") miss the singular names and aliases ("egg"); try the singular too.
  const singular = alt
    .split(" ")
    .map((t) => (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t))
    .join(" ");
  if (!variants.includes(singular)) variants.push(singular);
  return variants;
}

export interface SearchHit {
  food: Food;
  score: number;
  /** The query is one of this food's aliases: a known name for it in the household. */
  alias_match: boolean;
}

export function search(db: Db, query: string, limit = 10, sources?: Source[]): SearchHit[] {
  const q = query.trim();
  if (!q) return [];
  const best = new Map<number, number>();
  for (const variant of queryVariants(q)) {
    for (const mode of ["and", "or"] as const) {
      const match = ftsQuery(variant, mode);
      if (match === null) break;
      const found = db.all<{ rowid: number; rank: number }>(
        sql`SELECT rowid, bm25(food_fts, 10.0, 6.0) AS rank FROM food_fts
            WHERE food_fts MATCH ${match} ORDER BY rank LIMIT 300`,
      );
      // An all-words match outranks any partial match.
      const penalty = mode === "and" ? 0 : 15;
      for (const { rowid, rank } of found) {
        best.set(rowid, Math.min(best.get(rowid) ?? 1e9, rank + penalty));
      }
      if (found.length) break;
    }
  }
  if (!best.size) return [];
  const rows = [...best.entries()].sort((a, b) => a[1] - b[1]).slice(0, 300);
  const ids = rows.map((r) => r[0]);
  const byId = new Map(
    db
      .select()
      .from(foods)
      .where(and(inArray(foods.id, ids), isNull(foods.deleted_at)))
      .all()
      .map((f) => [f.id, f]),
  );
  const popularity = new Map(
    db
      .select({ food_id: entries.food_id, count: sql<number>`count(*)` })
      .from(entries)
      .where(inArray(entries.food_id, ids))
      .groupBy(entries.food_id)
      .all()
      .map((r) => [r.food_id, r.count]),
  );
  const forms = new Set(queryVariants(q));
  const hits: SearchHit[] = [];
  for (const [id, rank] of rows) {
    const food = byId.get(id);
    if (!food || (sources && !sources.includes(food.source))) continue;
    let score = -rank + (SOURCE_BOOST[food.source] ?? 0);
    score += 2 * Math.log2(1 + (popularity.get(id) ?? 0));
    if (forms.has(tokens(food.name).join(" "))) score += 8;
    const alias_match = food.aliases.some((a) => forms.has(a.toLowerCase().trim()));
    if (alias_match) score += 20;
    // Short names are usually the generic item ("Egg, whole, raw" over "Egg, whole, cooked, ...").
    score -= 0.04 * food.name.length;
    hits.push({ food, score, alias_match });
  }
  hits.sort((a, b) => b.score - a.score);
  // USDA repeats many foods across its Foundation, SR Legacy and FNDDS sets; keep the best-ranked one.
  const out: SearchHit[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    const key = hit.food.name.toLowerCase();
    if (hit.food.source === "usda") {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(hit);
    if (out.length >= limit) break;
  }
  return out;
}

// --- portions -------------------------------------------------------------------------------------

export function normalizeLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/\(s\)|\(es\)/g, "")
    .replace(/^(1|one|a|an)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function defaultServing(food: Food): Serving | null {
  return food.servings.find((s) => s.default) ?? food.servings[0] ?? null;
}

export function findServing(food: Food, label: string | null | undefined): Serving | null {
  if (!label) return defaultServing(food);
  const want = normalizeLabel(label);
  const exact = food.servings.find((s) => normalizeLabel(s.label) === want);
  if (exact) return exact;
  return (
    food.servings.find((s) => {
      const have = normalizeLabel(s.label);
      return have.startsWith(want) || want.startsWith(have) || have.split(" ").includes(want);
    }) ?? null
  );
}

export interface Portion {
  grams: number;
  servings: number | null;
  serving_label: string | null;
}

export interface PortionInput {
  servings?: number | null;
  serving?: string | null;
  grams?: number | null;
}

export function resolvePortion(food: Food, input: PortionInput = {}): Portion {
  const { servings, serving, grams } = input;
  if (grams != null) {
    if (grams <= 0) throw new DomainError("grams must be positive");
    return { grams, servings: null, serving_label: null };
  }
  const count = servings ?? 1;
  if (count <= 0) throw new DomainError("servings must be positive");
  const found = findServing(food, serving);
  if (!found && serving) {
    const unit = /^(\d+(?:\.\d+)?)?\s*(g|gram|grams|ml)$/.exec(normalizeLabel(serving));
    if (unit) {
      const per = Number(unit[1] ?? 1);
      if (per === 1) return { grams: count, servings: null, serving_label: null };
      return { grams: per * count, servings: count, serving_label: `${g(per)} g` };
    }
    const known = food.servings.map((s) => s.label).join(", ") || "none";
    throw new DomainError(
      `'${food.name}' has no '${serving}' serving (known: ${known}). Pass grams instead.`,
    );
  }
  if (!found) return { grams: 100 * count, servings: count, serving_label: "100 g" };
  return { grams: found.grams * count, servings: count, serving_label: found.label };
}

export function scale(food: Food, grams: number): Nutrients {
  const factor = grams / 100;
  return Object.fromEntries(
    NUTRIENTS.map((n) => [n, food[n] === null ? null : round(food[n] * factor, 2)]),
  ) as Nutrients;
}

export function describePortion(
  servings: number | null | undefined,
  serving_label: string | null | undefined,
  grams: number | null | undefined,
): string {
  if (serving_label && servings != null) {
    const label = serving_label.replace(/^1\s+/, "");
    return `${g(servings)} × ${label}${grams ? ` (${g(grams)} g)` : ""}`;
  }
  return grams != null ? `${g(grams)} g` : "";
}

// --- household foods ------------------------------------------------------------------------------

export function oursFoods(db: Db): Food[] {
  return db
    .select()
    .from(foods)
    .where(and(eq(foods.source, "ours"), isNull(foods.deleted_at)))
    .orderBy(asc(foods.name))
    .all();
}

/** Changes when anything the agent is told about the household foods changes. */
export function oursFingerprint(list: Food[]): string {
  const payload = list.map((f) => [f.id, f.name, f.brand, f.aliases, f.servings, NUTRIENTS.map((n) => f[n])]);
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

export function getFood(db: Db, id: number, options: { includeDeleted?: boolean } = {}): Food {
  const food = db.select().from(foods).where(eq(foods.id, id)).get();
  if (!food || (food.deleted_at !== null && !options.includeDeleted)) {
    throw new DomainError(`No food with id ${id}`);
  }
  return food;
}

function cleanServings(servings: { label?: unknown; grams?: unknown; default?: unknown }[]): Serving[] {
  const out: Serving[] = [];
  const seen = new Set<string>();
  for (const s of servings) {
    const label = String(s.label ?? "").trim();
    const grams = Number(s.grams ?? 0);
    if (!label || !(grams > 0)) throw new DomainError("each serving needs a label and grams > 0");
    const key = normalizeLabel(label);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, grams: round(grams, 2), default: Boolean(s.default) });
  }
  // Exactly one default: the first marked, else the first.
  const first = Math.max(
    0,
    out.findIndex((s) => s.default),
  );
  out.forEach((s, i) => (s.default = i === first));
  return out;
}

function cleanAliases(aliases: string[]): string[] {
  const out: string[] = [];
  for (const raw of aliases) {
    const a = raw.trim().toLowerCase();
    if (a && !out.includes(a)) out.push(a);
  }
  return out;
}

export interface FoodInput {
  food_id?: number | null;
  name?: string | null;
  brand?: string | null;
  description?: string | null;
  /** Per 100 g. */
  nutrients?: Partial<Nutrients> | null;
  servings?: { label?: unknown; grams?: unknown; default?: unknown }[] | null;
  aliases?: string[] | null;
}

/** Create or update a household food. `created` says which. */
export function saveOurs(
  db: Db,
  userId: number | null,
  input: FoodInput,
  changes: ChangeLog = noChanges,
): { food: Food; created: boolean } {
  const values: Partial<typeof foods.$inferInsert> = {};
  if (input.name != null) values.name = input.name.trim();
  if (input.brand != null) values.brand = input.brand.trim() || null;
  if (input.description != null) values.description = input.description.trim() || null;
  if (input.nutrients != null) {
    for (const n of NUTRIENTS) {
      if (!(n in input.nutrients)) continue;
      const value = input.nutrients[n] ?? null;
      if (value !== null && value < 0) throw new DomainError(`${n} can't be negative`);
      values[n] = value;
    }
  }
  if (input.servings != null) values.servings = cleanServings(input.servings);
  const aliases = input.aliases != null ? cleanAliases(input.aliases) : null;
  if (aliases) values.aliases = aliases;

  let id: number;
  let created = false;
  if (input.food_id != null) {
    const current = getFood(db, input.food_id);
    if (current.source !== "ours") {
      throw new DomainError(
        `'${current.name}' is reference data (${SOURCE_LABEL[current.source]}) and can't be edited`,
      );
    }
    id = current.id;
  } else {
    if (!values.name) throw new DomainError("a new food needs a name");
    if (values.kcal == null) throw new DomainError("a new food needs kcal per 100 g");
    id = db
      .insert(foods)
      .values({ source: "ours", name: values.name, created_by: userId })
      .returning({ id: foods.id })
      .get().id;
    created = true;
  }

  // An alias points to one household food; taking it moves it off any other.
  if (aliases?.length) {
    for (const other of oursFoods(db)) {
      if (other.id === id || !other.aliases.some((a) => aliases.includes(a))) continue;
      changes.track(foods, other.id, () =>
        db
          .update(foods)
          .set({ aliases: other.aliases.filter((a) => !aliases.includes(a)) })
          .where(eq(foods.id, other.id))
          .run(),
      );
    }
  }
  const write = () => {
    if (Object.keys(values).length) db.update(foods).set(values).where(eq(foods.id, id)).run();
  };
  if (created) {
    write();
    changes.created(foods, id);
  } else {
    changes.track(foods, id, write);
  }
  return { food: getFood(db, id), created };
}

/** Household foods are kept when deleted, so past entries still show what they were. */
export function deleteOurs(db: Db, id: number, changes: ChangeLog = noChanges): Food {
  const food = getFood(db, id);
  if (food.source !== "ours") {
    throw new DomainError(`'${food.name}' is reference data and can't be deleted`);
  }
  changes.track(foods, id, () =>
    db.update(foods).set({ deleted_at: new Date() }).where(eq(foods.id, id)).run(),
  );
  return food;
}

// --- reference data -------------------------------------------------------------------------------

const USDA_NOISE = /\s*\(Includes foods for USDA's Food Distribution Program\)/gi;
const FINGERPRINT_KEY = "reference_fingerprint";

function referenceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl.gz"))
    .sort()
    .map((f) => path.join(dir, f));
}

export function referenceFingerprint(dir: string): string {
  const hash = crypto.createHash("sha256");
  for (const file of [...referenceFiles(dir), path.join(dir, "aliases.json")]) {
    if (!fs.existsSync(file)) continue;
    hash.update(path.basename(file));
    hash.update(fs.readFileSync(file));
  }
  return hash.digest("hex").slice(0, 16);
}

interface ReferenceRecord {
  source: Source;
  source_ref: string | number;
  name: string;
  brand?: string | null;
  description?: string | null;
  category?: string | null;
  per_100g: Partial<Nutrients>;
  servings?: Serving[];
  meta?: Record<string, unknown>;
}

function applyReferenceAliases(db: Db, dir: string): void {
  const file = path.join(dir, "aliases.json");
  if (!fs.existsSync(file)) return;
  const curated = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, string[]>;
  for (const [key, aliases] of Object.entries(curated)) {
    if (key.startsWith("_")) continue;
    const split = key.indexOf(":");
    const source = key.slice(0, split) as Source;
    const name = key.slice(split + 1);
    const food = db
      .select({ id: foods.id })
      .from(foods)
      .where(and(eq(foods.source, source), eq(foods.name, name), isNull(foods.deleted_at)))
      .get();
    if (!food) {
      console.warn(`aliases.json: no ${source} food named ${JSON.stringify(name)}`);
      continue;
    }
    db.update(foods).set({ aliases: cleanAliases(aliases) }).where(eq(foods.id, food.id)).run();
  }
}

/**
 * Upsert the read-only reference foods. Ids stay stable so old log entries keep their links.
 * Returns how many were loaded; 0 when the files haven't changed since the last load.
 */
export function loadReference(db: Db, dir: string, options: { force?: boolean } = {}): number {
  const files = referenceFiles(dir);
  if (!files.length) return 0;
  const fingerprint = referenceFingerprint(dir);
  if (getMeta(db, FINGERPRINT_KEY) === fingerprint && !options.force) return 0;

  return db.transaction((tx) => {
    const existing = new Map(
      tx
        .select({ id: foods.id, source: foods.source, source_ref: foods.source_ref })
        .from(foods)
        .where(ne(foods.source, "ours"))
        .all()
        .map((f) => [`${f.source}:${f.source_ref}`, f.id]),
    );
    const seen = new Set<string>();
    let count = 0;
    for (const file of files) {
      const lines = zlib.gunzipSync(fs.readFileSync(file)).toString("utf8").split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        const rec = JSON.parse(line) as ReferenceRecord;
        const key = `${rec.source}:${rec.source_ref}`;
        seen.add(key);
        const values = {
          source: rec.source,
          source_ref: String(rec.source_ref),
          name: rec.name.replace(USDA_NOISE, "").trim(),
          brand: rec.brand ?? null,
          description: rec.description ?? null,
          category: rec.category ?? null,
          servings: rec.servings ?? [],
          aliases: [] as string[],
          meta: rec.meta ?? {},
          deleted_at: null,
          ...(Object.fromEntries(NUTRIENTS.map((n) => [n, rec.per_100g[n] ?? null])) as Nutrients),
        };
        const id = existing.get(key);
        if (id !== undefined) tx.update(foods).set(values).where(eq(foods.id, id)).run();
        else existing.set(key, tx.insert(foods).values(values).returning({ id: foods.id }).get().id);
        count += 1;
      }
    }
    applyReferenceAliases(tx as Db, dir);
    const gone = [...existing].filter(([key]) => !seen.has(key)).map(([, id]) => id);
    for (let i = 0; i < gone.length; i += 500) {
      tx.update(foods)
        .set({ deleted_at: new Date() })
        .where(inArray(foods.id, gone.slice(i, i + 500)))
        .run();
    }
    setMeta(tx as Db, FINGERPRINT_KEY, fingerprint);
    return count;
  });
}
