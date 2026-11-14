import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { schema as warren, vapidKeys } from "warren/server";
import { expect, test } from "vitest";
import * as foodSvc from "../src/foods.js";
import { importLegacy } from "../src/importLegacy.js";
import * as logSvc from "../src/log.js";
import { entries, entry_edits, foods, pins, saved_meals } from "../src/schema.js";
import { FakeClaude, say, testBao, turn } from "./helpers.js";

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/legacy");

function imported() {
  // A copy of the fixture with a reminder key beside it, as a real data directory has.
  const old = fs.mkdtempSync(path.join(os.tmpdir(), "bao-legacy-"));
  fs.cpSync(FIXTURE, old, { recursive: true });
  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  fs.writeFileSync(path.join(old, "vapid_private.pem"), privateKey.export({ type: "pkcs8", format: "pem" }));

  const claude = new FakeClaude([say("Hello again.")]);
  const fresh = testBao({ anthropic: claude, reference: fs.mkdtempSync(path.join(os.tmpdir(), "bao-noref-")) });
  // testBao loads no reference here, so the database is empty, as on a first start.
  const counts = importLegacy(fresh.db, old, fresh.app.config.dataDir);
  return { ...fresh, counts, claude, old, privateKey };
}

test("everything comes across with its ids", async () => {
  const { db, counts, app } = imported();
  expect(counts).toEqual({
    people: 2, profiles: 2, devices: 1, photos: 1, foods: 8, entries: 3, pins: 1,
    "saved meals": 1, "hand edits": 1, threads: 1, turns: 2, changes: 5,
  });
  const alice = db.select().from(warren.users).where(eq(warren.users.oidcSub, "dev:alice")).get()!;
  expect(alice).toMatchObject({ id: 1, name: "Alice", email: "alice@example.com" });
  expect(alice.createdAt.getUTCFullYear()).toBe(2026);
  expect(logSvc.profileOf(db, alice)).toMatchObject({ kcal_target: 1800, protein_target_g: 120, reminder_time: "20:30", reminded_on: "2026-03-02" });

  // entries still point at their foods and photos
  const day = logSvc.entriesBetween(db, alice, "2026-03-02", "2026-03-03");
  expect(day.map((e) => [e.id, e.name, e.is_estimate, e.origin, e.photo_id])).toEqual([
    [1, "Laksa", false, "manual", null],
    [4, "Toast", true, "agent", 1],
  ]);
  expect(foodSvc.getFood(db, day[0]!.food_id!).name).toBe("Laksa");
  expect(db.select().from(pins).all()).toHaveLength(1);
  expect(db.select().from(saved_meals).get()!.items[0]).toMatchObject({ serving_label: "cup", servings: 1 });
  const edit = db.select().from(entry_edits).get()!;
  expect([edit.entry_id, edit.before.servings, edit.after!.servings]).toEqual([4, null, 2]);

  // foods are searchable, deleted ones are not, household ones keep their aliases
  expect(foodSvc.search(db, "yogurt")[0]!.food).toMatchObject({ name: "Greek Light", brand: "Chobani", source: "ours" });
  expect(foodSvc.search(db, "oat drink")).toEqual([]);
  expect(db.select().from(foods).where(eq(foods.name, "Old Oat Drink")).get()!.deleted_at).toBeInstanceOf(Date);

  // the photo is where the app reads it from
  const file = db.select().from(warren.files).get()!;
  const bytes = fs.readFileSync(path.join(app.config.dataDir, "files", file.path));
  expect([file.bytes, bytes.subarray(0, 2).toString("hex")]).toEqual([bytes.length, "ffd8"]);
});

test("old turns show in the day's conversation and can still be undone", async () => {
  const bao = imported();
  const alice = await bao.as("Alice");
  const turns = (await alice.get("/api/agent/turns?scope=2026-03-03")).turns;
  expect(turns.map((t: any) => [t.user_text, t.reply_text, t.status, t.rating, t.rating_note, t.file_ids])).toEqual([
    ["breakfast", "Logged.", "ok", -1, "wrong portion", [1]],
    ["remove the kopi", "Removed.", "ok", null, null, []],
  ]);
  expect(turns[0].changes.map((c: any) => [c.table, c.action, c.name])).toEqual([
    ["entries", "create", "Kopi C"], ["entries", "create", "Toast"], ["foods", "create", "Soy Milk"], ["entries", "update", "Laksa"],
  ]);
  expect(turns[0].changes[2]).toMatchObject({ serving: "glass", kcal: 116, aliases: ["soy milk"] });

  // undo the second turn (a delete), then the first (two creates, a new food, an edit)
  await alice.post(`/api/agent/turns/${turns[1].id}/undo`);
  expect(bao.db.select().from(entries).where(eq(entries.id, 3)).get()).toMatchObject({ name: "Kopi C", is_estimate: false, grams: 250, photo_id: 1 });
  await alice.post(`/api/agent/turns/${turns[0].id}/undo`);
  const left = bao.db.select().from(entries).all();
  expect(left.map((e) => [e.id, e.name, e.servings, e.grams])).toEqual([[1, "Laksa", 1, 604], [2, "Bun", null, null]]);
  expect(foodSvc.search(bao.db, "soy milk")).toEqual([]);
});

test("a new conversation works on the imported data, and the reminder key is kept", async () => {
  const bao = imported();
  const alice = await bao.as("Alice");
  const events = await turn(bao, alice, "hi", { day: "2026-03-03" });
  expect(events.at(-1).turn.reply_text).toBe("Hello again.");
  expect(bao.claude.requests[0]!.messages).toHaveLength(1); // old threads are history, not replayed
  expect(bao.claude.requests[0]!.messages[0].content.at(-1).text).toContain("Greek Light (Chobani) [Ours]");

  // devices subscribed under the old key still verify against it
  const keys = vapidKeys(bao.app.config.dataDir);
  const jwk = bao.privateKey.export({ format: "jwk" });
  expect(keys.privateKey).toBe(jwk.d);
  expect(Buffer.from(keys.publicKey, "base64url").subarray(1).toString("base64url")).toBe(
    Buffer.concat([Buffer.from(jwk.x!, "base64url"), Buffer.from(jwk.y!, "base64url")]).toString("base64url"),
  );
  expect((await alice.get("/api/push/key")).key).toBe(keys.publicKey);

  expect(() => importLegacy(bao.db, bao.old, bao.app.config.dataDir)).toThrow("already has people");
});
