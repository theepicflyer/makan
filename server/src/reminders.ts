/**
 * Daily reminders to log food, sent as Web Push notifications.
 *
 * Each person picks a time (profiles.reminder_time, in the app's timezone). Once a minute the job
 * finds people whose time has come for the current log date and, unless breakfast, lunch and
 * dinner are already logged, notifies every device they turned reminders on for. Warren stores
 * the devices and sends; a device the push service no longer knows is dropped.
 */
import { eq, inArray } from "drizzle-orm";
import {
  type Db,
  deliver,
  DomainError,
  type Job,
  type Notification,
  type PushSubscription,
  schema as warren,
  type Sender,
  subscriptionsOf,
  type User,
} from "warren/server";
import { addDays, DAY_ROLLOVER_HOUR, instant, logDay } from "./dates.js";
import * as logSvc from "./log.js";
import { profiles } from "./schema.js";

const MAIN_MEALS = ["breakfast", "lunch", "dinner"] as const;
/** A reminder missed while the server was down still goes out this late; after that it waits for tomorrow. */
const GRACE_MS = 2 * 3_600_000;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseTime(value: string): { hour: number; minute: number } {
  const m = TIME.exec(value);
  if (!m) throw new DomainError("Use a time like 21:00");
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

export function timeLabel(value: string): string {
  const { hour, minute } = parseTime(value);
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "am" : "pm"}`;
}

/**
 * When the reminder for a log date goes out. A time before the rollover hour (say 00:30) is the
 * night after that date, still part of its day.
 */
export function dueAt(reminderTime: string, day: string, timezone: string): Date {
  const { hour, minute } = parseTime(reminderTime);
  return instant(hour < DAY_ROLLOVER_HOUR ? addDays(day, 1) : day, hour, minute, timezone);
}

/**
 * After the time changes or reminders are turned on: a time already past today waits for tomorrow
 * rather than firing at once, and one still to come today goes out today.
 */
export function settle(db: Db, user: User, timezone: string, now = new Date()): void {
  const profile = logSvc.profileOf(db, user);
  const day = logDay(now, timezone);
  const passed = dueAt(profile.reminder_time, day, timezone).getTime() <= now.getTime();
  db.update(profiles).set({ reminded_on: passed ? day : null }).where(eq(profiles.user_id, user.id)).run();
}

export function setTime(db: Db, user: User, value: string, timezone: string, now = new Date()): void {
  parseTime(value);
  logSvc.profileOf(db, user);
  db.update(profiles).set({ reminder_time: value }).where(eq(profiles.user_id, user.id)).run();
  settle(db, user, timezone, now);
}

/** The notification for a log date, or null when breakfast, lunch and dinner are all logged. */
export function reminderFor(db: Db, user: User, day: string): Notification | null {
  const logged = new Set(logSvc.entriesBetween(db, user, day, day).map((e) => e.meal));
  const missing = MAIN_MEALS.filter((m) => !logged.has(m));
  if (!missing.length) return null;
  let body: string;
  if (!logged.size) {
    body = "Nothing logged today yet. Tell Bao what you ate.";
  } else {
    const names =
      missing.length === 1 ? missing[0]! : `${missing.slice(0, -1).join(", ")} and ${missing.at(-1)}`;
    const verb = missing.length === 1 ? "isn't" : "aren't";
    body = `${names[0]!.toUpperCase()}${names.slice(1)} ${verb} logged yet. Tell Bao what you ate.`;
  }
  return { title: "Time to log your food", body, url: `/day/${day}`, topic: "reminder" };
}

export function confirmation(db: Db, user: User): Notification {
  const time = timeLabel(logSvc.profileOf(db, user).reminder_time);
  return {
    title: "Reminders are on",
    body: `You'll get one at ${time} on days you haven't logged yet.`,
    url: "/settings",
    topic: "reminder",
  };
}

/**
 * Send the reminders that are due at `now`. Each person's day is marked settled before anything
 * is sent, in a short transaction, so a slow push service never holds the database.
 */
export async function tick(db: Db, send: Sender, timezone: string, now = new Date()): Promise<number> {
  const day = logDay(now, timezone);
  const outbox: { sub: PushSubscription; message: Notification }[] = [];
  db.transaction((tx) => {
    const t = tx as Db;
    const userIds = [
      ...new Set(t.select({ id: warren.pushSubscriptions.userId }).from(warren.pushSubscriptions).all().map((r) => r.id)),
    ];
    if (!userIds.length) return;
    for (const user of t.select().from(warren.users).where(inArray(warren.users.id, userIds)).all()) {
      const profile = logSvc.profileOf(t, user);
      if (profile.reminded_on === day) continue;
      const at = dueAt(profile.reminder_time, day, timezone).getTime();
      if (!(at <= now.getTime() && now.getTime() < at + GRACE_MS)) continue;
      t.update(profiles).set({ reminded_on: day }).where(eq(profiles.user_id, user.id)).run();
      const message = reminderFor(t, user, day);
      if (!message) continue;
      for (const sub of subscriptionsOf(t, user.id)) outbox.push({ sub, message });
    }
  });
  return deliver(db, send, outbox);
}

export function reminderJob(db: Db, send: Sender, timezone: string): Job {
  return { name: "reminders", run: (now) => tick(db, send, timezone, now).then(() => {}) };
}
