/**
 * Export the assistant turns worth a second look, to review where Bao goes wrong.
 *
 * A turn is flagged when it got a thumbs down, ended in an error (or never finished), or logged
 * entries that someone later changed or deleted by hand. Each comes with what was said, the full
 * transcript, the rating note, what it changed, the hand edits and the paths of its photos.
 *
 *   node dist/exportFlagged.js --db /data/backup/app.sqlite
 *   node dist/exportFlagged.js --db app.sqlite --since 2026-11-01 --format markdown --out flagged.md
 *
 * The database is opened read-only. Photo paths assume the photos sit beside it in files/, as in DATA_DIR.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import Database from "better-sqlite3";

type Row = Record<string, any>;
const json = (value: unknown) => (typeof value === "string" ? JSON.parse(value) : value);
const iso = (ms: number | null) => (ms == null ? null : new Date(ms).toISOString());

function fileIds(messages: Row[]): number[] {
  const content = messages[0]?.content;
  if (!Array.isArray(content)) return [];
  return content
    .filter((b: Row) => b?.type === "image" && b.source?.type === "file_ref")
    .map((b: Row) => b.source.file_id as number);
}

export function flaggedTurns(db: Database.Database, filesDir: string, since?: string): Row[] {
  const sinceMs = since ? new Date(`${since}T00:00:00Z`).getTime() : 0;
  const turns = db
    .prepare(
      `SELECT t.*, th.user_id, th.scope AS log_date
       FROM warren_turns t JOIN warren_threads th ON th.id = t.thread_id
       WHERE t.created_at >= ? ORDER BY t.id`,
    )
    .all(sinceMs) as Row[];
  const out: Row[] = [];
  for (const t of turns) {
    const changes = (db.prepare("SELECT * FROM warren_changes WHERE turn_id = ? ORDER BY id").all(t.id) as Row[]).map((c) => ({
      table: c.table_name,
      action: c.action,
      row_id: c.row_id,
      before: json(c.before),
      after: json(c.after),
    }));
    const logged = [...new Set(changes.filter((c) => c.table === "entries" && c.action !== "delete").map((c) => c.row_id))].sort((a, b) => a - b);
    let edits: Row[] = [];
    if (logged.length) {
      const marks = logged.map(() => "?").join(",");
      edits = (
        db
          .prepare(`SELECT * FROM entry_edits WHERE user_id = ? AND entry_id IN (${marks}) AND created_at >= ? ORDER BY id`)
          .all(t.user_id, ...logged, t.created_at) as Row[]
      ).map((e) => ({
        entry_id: e.entry_id,
        action: e.action,
        before: json(e.before),
        after: json(e.after),
        created_at: iso(e.created_at),
      }));
    }

    const reasons: string[] = [];
    if (t.rating === -1) reasons.push("thumbs_down");
    if (t.status === "error" || t.status === "running") reasons.push(t.status === "error" ? "error" : "unfinished");
    if (edits.length) reasons.push("hand_edited");
    if (!reasons.length) continue;

    const messages = (json(t.messages) ?? []) as Row[];
    const photos = fileIds(messages).map((id) => {
      const row = db.prepare("SELECT path FROM warren_files WHERE id = ?").get(id) as Row | undefined;
      return row ? path.join(filesDir, row.path) : null;
    });
    out.push({
      turn_id: t.id,
      thread_id: t.thread_id,
      user_id: t.user_id,
      log_date: t.log_date,
      created_at: iso(t.created_at),
      app_version: t.app_version,
      model: json(t.usage)?.model ?? null,
      reasons,
      status: t.status,
      error: t.error,
      rating: t.rating,
      rating_note: t.rating_note,
      undone: t.undone_at !== null,
      user_text: t.user_text,
      reply_text: t.reply_text,
      photos,
      changes,
      hand_edits: edits,
      messages,
    });
  }
  return out;
}

export function toMarkdown(turns: Row[]): string {
  const lines = [`# Flagged turns (${turns.length})`, ""];
  for (const t of turns) {
    lines.push(
      `## Turn ${t.turn_id}: ${t.reasons.join(", ")}`,
      "",
      `- Log date: ${t.log_date}; sent: ${t.created_at}; user ${t.user_id}; thread ${t.thread_id}`,
      `- Status: ${t.status}${t.error ? ` (${t.error})` : ""}`,
      `- App version: ${t.app_version || "unknown"}; model: ${t.model || "unknown"}`,
    );
    if (t.rating !== null) lines.push(`- Rating: ${t.rating > 0 ? "+" : ""}${t.rating}${t.rating_note ? `, note: ${t.rating_note}` : ""}`);
    if (t.undone) lines.push("- Undone");
    for (const photo of t.photos) lines.push(`- Photo: ${photo ?? "(missing)"}`);
    lines.push("", "**User:**", "", t.user_text || "(no text)", "", "**Reply:**", "", t.reply_text || "(none)", "");
    for (const [title, key] of [["Changes", "changes"], ["Hand edits", "hand_edits"], ["Transcript", "messages"]] as const) {
      if (t[key].length) lines.push(`**${title}:**`, "", "```json", JSON.stringify(t[key], null, 2), "```", "");
    }
  }
  return lines.join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { values: args } = parseArgs({
    options: {
      db: { type: "string" }, // the SQLite database (app.sqlite, or its snapshot)
      since: { type: "string" }, // only turns sent on or after this date, YYYY-MM-DD (UTC)
      format: { type: "string", default: "json" },
      out: { type: "string" }, // write here instead of stdout
    },
  });
  if (!args.db) {
    console.error("usage: node dist/exportFlagged.js --db <app.sqlite> [--since YYYY-MM-DD] [--format json|markdown] [--out file]");
    process.exit(2);
  }
  const file = path.resolve(args.db);
  const db = new Database(file, { readonly: true, fileMustExist: true });
  // A snapshot lives in DATA_DIR/backup; the photos are in DATA_DIR/files either way.
  const dataDir = path.basename(path.dirname(file)) === "backup" ? path.dirname(path.dirname(file)) : path.dirname(file);
  const turns = flaggedTurns(db, path.join(dataDir, "files"), args.since);
  db.close();
  const text = args.format === "markdown" ? toMarkdown(turns) : JSON.stringify(turns, null, 2);
  if (args.out) {
    fs.writeFileSync(args.out, `${text}\n`);
    console.error(`${turns.length} flagged turns written to ${args.out}`);
  } else {
    console.log(text);
  }
}
