import { kcal, parseDate } from './format.ts';
import type { HistoryDay, NutrientKey } from './types.ts';

/** Under a day's bar: the weekday letter for two weeks or less, else the date on Mondays. */
export function dayAxisLabel(iso: string, count: number): string {
	const d = parseDate(iso);
	if (count <= 14) return d.toLocaleDateString('en-SG', { weekday: 'narrow' });
	return d.getDay() === 1 ? d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' }) : '';
}

export function shortDate(iso: string): string {
	return parseDate(iso).toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** "8 Oct – 21 Oct", with the year on both ends when either isn't this year. */
export function spanLabel(start: string, end: string, today: string): string {
	const year = start.slice(0, 4) !== today.slice(0, 4) || end.slice(0, 4) !== today.slice(0, 4);
	const fmt = (iso: string) => parseDate(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) });
	return `${fmt(start)} – ${fmt(end)}`;
}

export function dayAria(d: HistoryDay): string {
	return `${parseDate(d.date).toDateString()}: ${d.entries ? `${kcal(d.kcal)} kcal` : 'not logged'}`;
}

/** The average over the days with anything logged; days with nothing logged would drag it to zero. */
export function loggedAverage(days: HistoryDay[], key: NutrientKey): number | null {
	const logged = days.filter((d) => d.entries > 0);
	return logged.length ? logged.reduce((s, d) => s + (d[key] ?? 0), 0) / logged.length : null;
}

/** Calories averaged over each day and the six before it (logged days only), from `lead` extra days fetched before the range. */
export function rollingKcal(all: HistoryDay[], lead: number, window = 7): (number | null)[] {
	return all.slice(lead).map((_, i) => {
		const span = all.slice(Math.max(0, i + lead - window + 1), i + lead + 1).filter((d) => d.entries > 0);
		return span.length ? span.reduce((s, d) => s + (d.kcal ?? 0), 0) / span.length : null;
	});
}

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Average calories on each weekday, Monday first, over logged days. */
export function weekdayKcal(days: HistoryDay[]): { name: string; avg: number | null; count: number }[] {
	return WEEKDAYS.map((name, w) => {
		const on = days.filter((d) => d.entries > 0 && (parseDate(d.date).getDay() + 6) % 7 === w);
		return { name, avg: on.length ? on.reduce((s, d) => s + (d.kcal ?? 0), 0) / on.length : null, count: on.length };
	});
}
