/** Days are "YYYY-MM-DD" strings in the household's timezone; these are the sums on them. */
import { DomainError, localTime } from "warren/server";

/** Before this hour, "today" still means the previous day. */
export const DAY_ROLLOVER_HOUR = 4;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function utc(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

export function isDay(value: string): boolean {
  if (!DAY.test(value)) return false;
  const d = utc(value);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function parseDay(value: string): string {
  if (!isDay(value)) throw new DomainError(`'${value}' is not a YYYY-MM-DD date`);
  return value;
}

export function addDays(day: string, days: number): string {
  const d = utc(day);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to).getTime() - utc(from).getTime()) / 86_400_000);
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Tue 03 Mar 2026 (2026-03-03)" */
export function formatDay(day: string): string {
  const d = utc(day);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${WEEKDAYS[d.getUTCDay()]} ${dd} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} (${day})`;
}

/** The log date at `now`: before the rollover hour it is still the previous day. */
export function logDay(now: Date, timezone: string): string {
  return localTime(new Date(now.getTime() - DAY_ROLLOVER_HOUR * 3_600_000), timezone).date;
}

/** The instant a wall-clock time on a day happens in `timezone`. */
export function instant(day: string, hour: number, minute: number, timezone: string): Date {
  // Start from the same wall time in UTC, then correct by the zone's offset at that moment.
  const guess = new Date(`${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
  const local = localTime(guess, timezone);
  const shown = new Date(
    `${local.date}T${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}:00Z`,
  );
  return new Date(guess.getTime() - (shown.getTime() - guess.getTime()));
}

/** A number as Python's "%g" prints it: up to six significant digits, no trailing zeros. */
export function g(value: number): string {
  return String(Number(value.toPrecision(6)));
}

export function round(value: number, places: number): number {
  const f = 10 ** places;
  return Math.round((value + Number.EPSILON) * f) / f;
}
