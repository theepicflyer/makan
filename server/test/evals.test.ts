import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { expect, test } from "vitest";
import { CASES } from "../evals/cases.js";
import { check, grade, seed } from "../evals/run.js";
import { Case, Item, Msg } from "../evals/spec.js";
import { flaggedTurns, toMarkdown } from "../src/exportFlagged.js";
import { importLegacy } from "../src/importLegacy.js";
import * as logSvc from "../src/log.js";
import { testBao } from "./helpers.js";

test("every eval case is well formed", () => {
  expect(CASES).toHaveLength(91);
  expect(CASES.flatMap((c) => check(c).map((p) => `${c.id}: ${p}`))).toEqual([]);
  expect(CASES.filter((c) => c.tags.includes("meal")).every((c) => !c.strict_count)).toBe(true);
});

test("the grader matches entries to expectations and names what is wrong", () => {
  const { db, foodId } = testBao();
  const c = Case("t", ["text"], [Msg("x")], {
    ours: [{ key: "yog", name: "Greek Light", nutrients: { kcal: 55 }, servings: [{ label: "tub", grams: 150 }], aliases: ["yogurt"] }],
    entries: [["2026-10-21", "lunch", "sg:Laksa", 1], { date: "2026-10-21", meal: "snacks", name: "Bun", kcal: 200 }, ["2026-10-21", "breakfast", "ours:yog", 2]],
    expect: [Item("laksa", "lunch", { kcal: [400, 450] }), Item("greek", "breakfast", { ours: "yog" }), Item("kopi", "breakfast")],
    total_kcal: [0, 100],
    forbid: ["bun"],
  });
  const { user, ours } = seed(db, c);
  expect(logSvc.entriesBetween(db, user, "2026-10-21", "2026-10-21").map((e) => e.food_id)).toEqual([ours.yog, foodId("Laksa"), null]);
  const result = grade(db, c, user, ours, "");
  expect(result.grade).toEqual({ pass: 0, items: 0.667 });
  expect(result.failures).toEqual([
    "missing breakfast /kopi/  (near: none)",
    "unexpected 2026-10-21 snacks Bun 200",
    "day total 782 kcal not in [0,100]",
    "should be gone: 2026-10-21 snacks Bun",
  ]);
  c.expect = [Item("laksa", "lunch"), Item("greek"), Item("bun", "snacks")];
  c.total_kcal = null;
  c.forbid = [];
  expect(grade(db, c, user, ours, "")).toEqual({ grade: { pass: 1, items: 1 }, failures: [] });
});

test("flagged turns are exported with their changes, hand edits and photos", () => {
  const fresh = testBao({ reference: fs.mkdtempSync(path.join(os.tmpdir(), "bao-noref-")) });
  const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/legacy");
  importLegacy(fresh.db, fixture, fresh.app.config.dataDir);
  fresh.app.database.sqlite.pragma("wal_checkpoint(TRUNCATE)");
  const db = new Database(fresh.app.database.path, { readonly: true });
  const turns = flaggedTurns(db, path.join(fresh.app.config.dataDir, "files"));
  db.close();
  expect(turns.map((t) => [t.turn_id, t.reasons, t.rating_note, t.log_date])).toEqual([
    [1, ["thumbs_down", "hand_edited"], "wrong portion", "2026-03-03"],
  ]);
  expect(turns[0]!.hand_edits.map((e: any) => [e.entry_id, e.action])).toEqual([[4, "update"]]);
  expect(turns[0]!.changes).toHaveLength(4);
  expect(fs.existsSync(turns[0]!.photos[0])).toBe(true);
  expect(toMarkdown(turns)).toContain("## Turn 1: thumbs_down, hand_edited");
});
