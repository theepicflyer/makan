import { eq } from "drizzle-orm";
import { schema as warren, type User } from "warren/server";
import { expect, test } from "vitest";
import { instant } from "../src/dates.js";
import * as logSvc from "../src/log.js";
import * as reminders from "../src/reminders.js";
import { profiles } from "../src/schema.js";
import { testBao } from "./helpers.js";

const TZ = "Asia/Singapore";
/** A wall-clock time in October 2026, Singapore. */
const at = (day: number, hour: number, minute = 0) => instant(`2026-10-${day}`, hour, minute, TZ);
const endpoint = (name: string) => `https://fcm.googleapis.com/fcm/send/${name}`;

function setup() {
  const bao = testBao();
  const person = (name: string, time = "21:00"): User => {
    const user = bao.user(name);
    logSvc.profileOf(bao.db, user);
    bao.db.update(profiles).set({ reminder_time: time }).where(eq(profiles.user_id, user.id)).run();
    bao.db.insert(warren.pushSubscriptions).values({ userId: user.id, endpoint: endpoint(name), p256dh: "p", auth: "a" }).run();
    return user;
  };
  const tick = (now: Date) => reminders.tick(bao.db, bao.app.push!, TZ, now);
  const to = (name: string) => bao.pushed.filter((p) => p.endpoint === endpoint(name)).map((p) => p.message);
  const meals = (user: User, ...names: string[]) => {
    for (const meal of names) logSvc.addEntry(bao.db, user, { day: "2026-10-22", meal, name: "Kopi C", nutrients: { kcal: 90 } });
  };
  return { ...bao, person, tick, to, meals };
}

test("times of day land on the right instant", () => {
  expect(at(22, 21).toISOString()).toBe("2026-10-22T13:00:00.000Z");
  expect(instant("2026-03-08", 2, 30, "America/New_York").toISOString()).toBe("2026-03-08T07:30:00.000Z");
});

test("a reminder goes out once at its time, each day", async () => {
  const { person, tick, to } = setup();
  person("Cora");
  await tick(at(22, 20, 59));
  expect(to("Cora")).toEqual([]);
  expect(await tick(at(22, 21, 0))).toBe(1);
  await tick(at(22, 21, 1));
  expect(to("Cora")).toEqual([
    { title: "Time to log your food", body: "Nothing logged today yet. Tell Bao what you ate.", url: "/day/2026-10-22", topic: "reminder" },
  ]);
  await tick(at(23, 21, 0));
  expect(to("Cora")).toHaveLength(2);
});

test("it names the meals still missing, and stays quiet once the day is logged", async () => {
  const { db, person, tick, to, meals } = setup();
  meals(person("Dev", "20:00"), "breakfast", "snacks");
  const eve = person("Eve", "20:00");
  meals(eve, "breakfast", "lunch", "dinner");
  meals(person("Fay", "20:00"), "breakfast", "lunch");
  await tick(at(22, 20, 0));
  expect(to("Dev")[0]!.body).toBe("Lunch and dinner aren't logged yet. Tell Bao what you ate.");
  expect(to("Fay")[0]!.body).toBe("Dinner isn't logged yet. Tell Bao what you ate.");
  expect(to("Eve")).toEqual([]);
  expect(logSvc.profileOf(db, eve).reminded_on).toBe("2026-10-22");
});

test("a late reminder still goes out within two hours, then waits for tomorrow", async () => {
  const { person, tick, to } = setup();
  person("Finn", "18:00");
  await tick(at(22, 20, 1));
  expect(to("Finn")).toEqual([]);
  await tick(at(22, 19, 59));
  expect(to("Finn")).toHaveLength(1);
});

test("a time after midnight belongs to the day before", async () => {
  const { person, tick, to } = setup();
  person("Gus", "00:30");
  await tick(at(23, 0, 30));
  expect(to("Gus")[0]!.url).toBe("/day/2026-10-22");
});

test("a device that is gone is dropped", async () => {
  const { db, gone, person, tick } = setup();
  person("Hana");
  gone.add(endpoint("Hana"));
  expect(await tick(at(22, 21, 0))).toBe(0);
  expect(db.select().from(warren.pushSubscriptions).all()).toEqual([]);
});

test("changing the time never fires at once", async () => {
  const { db, person, tick, to } = setup();
  const ivy = person("Ivy");
  // at 21:30, moving the time to 21:15 waits for tomorrow...
  reminders.setTime(db, ivy, "21:15", TZ, at(22, 21, 30));
  await tick(at(22, 21, 31));
  expect(to("Ivy")).toEqual([]);
  // ...and moving it to 22:00 still reminds tonight
  reminders.setTime(db, ivy, "22:00", TZ, at(22, 21, 32));
  await tick(at(22, 22, 0));
  expect(to("Ivy")).toHaveLength(1);
  expect(() => reminders.setTime(db, ivy, "24:00", TZ)).toThrow("Use a time like 21:00");
});

test("time labels", () => {
  expect(["21:00", "00:05", "12:30"].map(reminders.timeLabel)).toEqual(["9:00 pm", "12:05 am", "12:30 pm"]);
});

test("turning reminders on from the app: the key, the time, and a test notification", async () => {
  const bao = testBao();
  const alice = await bao.as("Alice");
  const key = Buffer.from((await alice.get("/api/push/key")).key, "base64url");
  expect([key.length, key[0]]).toEqual([65, 4]); // an uncompressed P-256 point

  expect((await (await alice.req("PATCH", "/api/me", { reminder_time: "07:30" })).json()).reminder_time).toBe("07:30");
  for (const bad of ["7:30", "24:00", "21:60", "nine"]) {
    expect((await alice.req("PATCH", "/api/me", { reminder_time: bad })).status).toBe(400);
  }
  for (const bad of ["https://evil.example/push", "http://fcm.googleapis.com/fcm/send/x", "https://google.com.evil.example/x", "https://127.0.0.1/x"]) {
    expect((await alice.req("POST", "/api/push/subscriptions", { endpoint: bad, keys: { p256dh: "p", auth: "a" } })).status).toBe(400);
  }
  const device = { endpoint: endpoint("alice-phone"), keys: { p256dh: "p", auth: "a" } };
  expect((await alice.req("POST", "/api/push/subscriptions", device)).status).toBe(200);

  expect((await alice.req("POST", "/api/push/test", { endpoint: device.endpoint })).status).toBe(200);
  expect(bao.pushed[0]!.message).toMatchObject({ title: "Reminders are on", body: "You'll get one at 7:30 am on days you haven't logged yet." });
  bao.gone.add(device.endpoint);
  expect((await alice.req("POST", "/api/push/test", { endpoint: device.endpoint })).status).toBe(410);
  expect(bao.db.select().from(warren.pushSubscriptions).all()).toEqual([]);
});

test("the reminder job is on the scheduler", () => {
  expect(testBao().app.jobs.map((j) => j.name)).toEqual(["snapshot", "reminders"]);
});
