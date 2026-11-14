/**
 * One-off: bring a database from the Python version of Bao (makan.db) into this one.
 *
 *   node dist/importLegacy.js <old data directory>
 *
 * Run it once, with the app stopped, into an empty DATA_DIR (or the same directory: the old files
 * are only read). Ids are kept, so log entries still point at their foods and photos. People sign
 * in again afterwards, and MCP clients reconnect: neither kind of session carries over.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { type Db, DB_FILE, loadConfig, openDatabase, runMigrations, schema as warren, setMeta } from "warren/server";
import { MIGRATIONS } from "./app.js";
import { entries, entry_edits, foods, NUTRIENTS, pins, profiles, saved_meals } from "./schema.js";

type Row = Record<string, any>;

/** The Python app stored UTC wall-clock text; this one stores milliseconds. */
function time(value: string | null): Date | null {
  return value ? new Date(`${value.replace(" ", "T")}Z`) : null;
}
const json = (value: string | null) => (value == null ? null : JSON.parse(value));
const nutrients = (row: Row) => Object.fromEntries(NUTRIENTS.map((n) => [n, row[n] ?? null]));

/** Stored photo references become Warren file references; nothing else in a message changes. */
function convertMessages(messages: any[]): any[] {
  return messages.map((msg) =>
    Array.isArray(msg.content)
      ? {
          ...msg,
          content: msg.content.map((b: any) =>
            b?.type === "image" && b.source?.type === "photo_ref"
              ? { type: "image", source: { type: "file_ref", file_id: b.source.photo_id } }
              : b,
          ),
        }
      : msg,
  );
}

/** An old undo snapshot as the row it describes is stored now. */
function convertSnapshot(table: string, snap: Row | null): Row | null {
  if (!snap || table !== "foods") return snap;
  return { ...snap, deleted_at: snap.deleted_at ? new Date(snap.deleted_at).getTime() : null };
}

/** The reminder key: the Python app kept a PEM, Warren keeps the two halves browsers and push services use. */
function convertVapid(pem: string): { publicKey: string; privateKey: string } {
  const jwk = crypto.createPrivateKey(pem).export({ format: "jwk" }) as { d: string; x: string; y: string };
  const point = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);
  return { publicKey: point.toString("base64url"), privateKey: jwk.d };
}

export function importLegacy(db: Db, oldDir: string, dataDir: string): Record<string, number> {
  const old = new Database(path.join(oldDir, "makan.db"), { readonly: true, fileMustExist: true });
  const all = (table: string): Row[] => old.prepare(`SELECT * FROM "${table}" ORDER BY 1`).all() as Row[];
  const counts: Record<string, number> = {};
  /** Insert in chunks; SQLite caps the number of bound values in one statement. */
  const insert = (name: string, table: any, rows: Row[]) => {
    counts[name] = rows.length;
    if (!rows.length) return;
    const chunk = Math.max(1, Math.floor(900 / Object.keys(rows[0]!).length));
    for (let i = 0; i < rows.length; i += chunk) db.insert(table).values(rows.slice(i, i + chunk)).run();
  };

  try {
    db.transaction((tx) => {
      if (tx.select({ n: sql<number>`count(*)` }).from(warren.users).get()!.n) {
        throw new Error("this database already has people in it; import into an empty one");
      }
      const users = all("users");
      insert("people", warren.users, users.map((u) => ({
        id: u.id, oidcSub: u.oidc_sub, email: u.email, name: u.name, createdAt: time(u.created_at),
      })));
      insert("profiles", profiles, users.map((u) => ({
        user_id: u.id, kcal_target: u.kcal_target, protein_target_g: u.protein_target_g,
        carb_target_g: u.carb_target_g, fat_target_g: u.fat_target_g,
        reminder_time: u.reminder_time, reminded_on: u.reminded_on,
      })));
      insert("devices", warren.pushSubscriptions, all("push_subscriptions").map((s) => ({
        id: s.id, userId: s.user_id, endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth, createdAt: time(s.created_at),
      })));
      insert("photos", warren.files, all("photos").map((p) => {
        const file = path.join(oldDir, "photos", p.path);
        return {
          id: p.id, userId: p.user_id, path: path.join("legacy", p.path), mediaType: p.media_type,
          bytes: fs.existsSync(file) ? fs.statSync(file).size : 0, createdAt: time(p.created_at),
        };
      }));
      insert("foods", foods, all("foods").map((f) => ({
        id: f.id, source: f.source, source_ref: f.source_ref, name: f.name, brand: f.brand,
        description: f.description, category: f.category, servings: json(f.servings) ?? [],
        aliases: json(f.aliases) ?? [], meta: json(f.meta) ?? {}, created_by: f.created_by,
        created_at: time(f.created_at), updated_at: time(f.updated_at), deleted_at: time(f.deleted_at),
        ...nutrients(f),
      })));
      insert("entries", entries, all("entries").map((e) => ({
        id: e.id, user_id: e.user_id, date: e.date, meal: e.meal, position: e.position, food_id: e.food_id,
        name: e.name, serving_label: e.serving_label, servings: e.servings, grams: e.grams,
        is_estimate: Boolean(e.is_estimate), note: e.note, photo_id: e.photo_id, origin: e.origin,
        created_at: time(e.created_at), updated_at: time(e.updated_at), ...nutrients(e),
      })));
      insert("pins", pins, all("pins").map((p) => ({
        id: p.id, user_id: p.user_id, food_id: p.food_id, serving_label: p.serving_label,
        servings: p.servings, grams: p.grams, position: p.position, created_at: time(p.created_at),
      })));
      insert("saved meals", saved_meals, all("saved_meals").map((m) => ({
        id: m.id, user_id: m.user_id, name: m.name, items: json(m.items) ?? [], created_at: time(m.created_at),
      })));
      insert("hand edits", entry_edits, all("entry_edits").map((e) => ({
        id: e.id, entry_id: e.entry_id, user_id: e.user_id, action: e.action,
        before: json(e.before), after: json(e.after), created_at: time(e.created_at),
      })));
      insert("threads", warren.threads, all("threads").map((t) => ({
        id: t.id, userId: t.user_id, scope: t.date, model: t.model,
        state: t.foods_fingerprint ? { foods: t.foods_fingerprint } : {}, createdAt: time(t.created_at),
      })));
      insert("turns", warren.turns, all("turns").map((t) => ({
        id: t.id, threadId: t.thread_id, userText: t.user_text, replyText: t.reply_text,
        messages: convertMessages(json(t.messages) ?? []), usage: json(t.usage) ?? {}, costUsd: t.cost_usd,
        status: t.status, error: t.error, appVersion: t.app_version, undoneAt: time(t.undone_at),
        rating: t.rating, ratingNote: t.rating_note, ratedAt: time(t.rated_at), createdAt: time(t.created_at),
      })));
      insert("changes", warren.changes, all("changes").map((c) => ({
        id: c.id, turnId: c.turn_id, table: c.table, action: c.action, rowId: c.row_id,
        before: convertSnapshot(c.table, json(c.before)), after: convertSnapshot(c.table, json(c.after)),
      })));
      const fingerprint = (old.prepare("SELECT value FROM meta WHERE key = 'reference_fingerprint'").get() as Row | undefined)?.value;
      if (fingerprint) setMeta(tx as Db, "reference_fingerprint", fingerprint);
    });
  } finally {
    old.close();
  }

  // Files go last, outside the transaction: a failed import leaves nothing behind in the database.
  const photos = path.join(oldDir, "photos");
  if (fs.existsSync(photos)) {
    fs.cpSync(photos, path.join(dataDir, "files", "legacy"), { recursive: true, errorOnExist: false, force: false });
  }
  const pem = path.join(oldDir, "vapid_private.pem");
  const vapid = path.join(dataDir, "vapid.json");
  if (fs.existsSync(pem) && !fs.existsSync(vapid)) {
    fs.writeFileSync(vapid, JSON.stringify(convertVapid(fs.readFileSync(pem, "utf8"))), { mode: 0o600 });
  }
  return counts;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const oldDir = process.argv[2];
  if (!oldDir) {
    console.error("usage: node dist/importLegacy.js <old data directory>   (stop the app first)");
    process.exit(2);
  }
  const { dataDir } = loadConfig();
  const database = openDatabase(path.join(dataDir, DB_FILE));
  runMigrations(database, [{ folder: MIGRATIONS, table: "bao_migrations" }]);
  const counts = importLegacy(database.db, oldDir, dataDir);
  database.sqlite.close();
  for (const [name, n] of Object.entries(counts)) console.log(`${String(n).padStart(7)} ${name}`);
  console.log(`imported ${oldDir} into ${dataDir}`);
}
