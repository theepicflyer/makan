import type { Food, Nutrients, Serving } from './types.ts';

export function kcal(value: number | null | undefined): string {
	if (value == null) return '–';
	return Math.round(value).toLocaleString('en-SG');
}

export function grams(value: number | null | undefined): string {
	if (value == null) return '–';
	return `${Math.round(value)}`;
}

export function qty(value: number): string {
	return Number.isInteger(value) ? `${value}` : `${Math.round(value * 100) / 100}`;
}

export function parseDate(iso: string): Date {
	const [y, m, d] = iso.split('-').map(Number);
	return new Date(y, m - 1, d);
}

export function isoDate(d: Date): string {
	const y = d.getFullYear();
	const m = `${d.getMonth() + 1}`.padStart(2, '0');
	const day = `${d.getDate()}`.padStart(2, '0');
	return `${y}-${m}-${day}`;
}

export function addDays(iso: string, n: number): string {
	const d = parseDate(iso);
	d.setDate(d.getDate() + n);
	return isoDate(d);
}

export function dayLabel(iso: string, today: string): string {
	if (iso === today) return 'Today';
	if (iso === addDays(today, -1)) return 'Yesterday';
	if (iso === addDays(today, 1)) return 'Tomorrow';
	const d = parseDate(iso);
	const sameYear = iso.slice(0, 4) === today.slice(0, 4);
	return d.toLocaleDateString('en-SG', {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		...(sameYear ? {} : { year: 'numeric' })
	});
}

export function longDate(iso: string): string {
	return parseDate(iso).toLocaleDateString('en-SG', {
		weekday: 'long',
		day: 'numeric',
		month: 'long'
	});
}

export function defaultServing(food: Food): Serving | null {
	return food.servings.find((s) => s.default) ?? food.servings[0] ?? null;
}

export function scale(per100: Nutrients, g: number): Nutrients {
	const out = {} as Nutrients;
	for (const [k, v] of Object.entries(per100) as [keyof Nutrients, number | null][]) {
		out[k] = v == null ? null : (v * g) / 100;
	}
	return out;
}

export function servingKcal(food: Food): string {
	const s = defaultServing(food);
	const g = s ? s.grams : 100;
	const v = food.per_100g.kcal;
	if (v == null) return '';
	return `${kcal((v * g) / 100)} kcal · ${s ? s.label : '100 g'}`;
}

/** "1 regular cup", "2 × slice", "150 g". SG FoodID labels already start with "1 ...". */
export function portionText(servings: number | null, label: string | null, g: number | null): string {
	if (label && servings != null) {
		const unit = label.replace(/^(1|one|a|an)\s+/i, '').replace(/\((s|es)\)/g, '');
		if (servings === 1) return /^\d/.test(label) ? label.replace(/\((s|es)\)/g, '') : `1 ${unit}`;
		return `${qty(servings)} × ${unit}`;
	}
	if (g != null) return `${Math.round(g)} g`;
	return '';
}

export function entryPortion(servings: number | null, label: string | null, g: number | null): string {
	const text = portionText(servings, label, g);
	return label && g != null && !/^\d+(\.\d+)? ?g$/.test(label) ? `${text} · ${Math.round(g)} g` : text;
}

export function initialPortion(
	food: Food,
	servings: number | null = null,
	label: string | null = null,
	g: number | null = null
): import('./types.ts').Portion {
	const match = label ? food.servings.find((s) => s.label === label) : null;
	if (match) return { unit: match.label, count: servings ?? 1, grams: g ?? match.grams };
	if (g != null && !label) return { unit: 'g', count: 1, grams: g };
	const d = defaultServing(food);
	if (d) return { unit: d.label, count: 1, grams: d.grams };
	return { unit: 'g', count: 1, grams: g ?? 100 };
}

export function portionPayload(p: import('./types.ts').Portion): {
	servings?: number;
	serving?: string;
	grams?: number;
} {
	if (p.unit === 'g') return { grams: Math.max(1, Number(p.grams) || 0) };
	return { servings: Math.max(0.25, Number(p.count) || 1), serving: p.unit };
}

export function portionGrams(food: Food, p: import('./types.ts').Portion): number {
	if (p.unit === 'g') return Number(p.grams) || 0;
	const s = food.servings.find((x) => x.label === p.unit);
	return (s?.grams ?? 100) * (Number(p.count) || 0);
}
