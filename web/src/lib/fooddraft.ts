import type { Food, FoodDraft, NutrientKey } from './types.ts';

export function emptyDraft(): FoodDraft {
	return {
		name: '',
		brand: '',
		description: '',
		aliases: [],
		basis: 'per_100g',
		serving_grams: null,
		nutrients: {
			kcal: null,
			protein_g: null,
			carb_g: null,
			fat_g: null,
			fibre_g: null,
			sugar_g: null,
			sodium_mg: null,
			sat_fat_g: null
		},
		servings: []
	};
}

export function draftFrom(food: Food): FoodDraft {
	return {
		name: food.name,
		brand: food.brand ?? '',
		description: food.description ?? '',
		aliases: [...food.aliases],
		basis: 'per_100g',
		serving_grams: food.servings.find((s) => s.default)?.grams ?? null,
		nutrients: { ...food.per_100g },
		servings: food.servings.map((s) => ({ ...s }))
	};
}

export function draftPayload(d: FoodDraft) {
	const nutrients = {} as Record<NutrientKey, number | null>;
	for (const [k, v] of Object.entries(d.nutrients) as [NutrientKey, unknown][]) {
		nutrients[k] = v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v);
	}
	return {
		name: d.name.trim(),
		brand: d.brand.trim(),
		description: d.description.trim(),
		aliases: d.aliases,
		basis: d.basis,
		serving_grams: d.basis === 'per_serving' ? Number(d.serving_grams) || null : null,
		nutrients,
		servings: d.servings
			.filter((s) => s.label.trim() && Number(s.grams) > 0)
			.map((s) => ({ label: s.label.trim(), grams: Number(s.grams), default: s.default }))
	};
}
