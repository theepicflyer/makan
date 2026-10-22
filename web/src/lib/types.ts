import type { TraceName } from './burrow/art.js';

export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'snacks';
export const MEALS: Meal[] = ['breakfast', 'lunch', 'dinner', 'snacks'];
export const MEAL_LABEL: Record<Meal, string> = {
	breakfast: 'Breakfast',
	lunch: 'Lunch',
	dinner: 'Dinner',
	snacks: 'Snacks'
};

/** The Burrow trace on each meal's list tiles: toast crumbs, a seed, a berry, a sunflower. */
export const MEAL_TRACE = { breakfast: 'crumbs', lunch: 'seed', dinner: 'berry', snacks: 'sunflower' } as const satisfies Record<
	Meal,
	TraceName
>;

export type NutrientKey =
	| 'kcal'
	| 'protein_g'
	| 'carb_g'
	| 'fat_g'
	| 'fibre_g'
	| 'sugar_g'
	| 'sodium_mg'
	| 'sat_fat_g';

export type Nutrients = Record<NutrientKey, number | null>;

export interface Targets {
	kcal: number | null;
	protein_g: number | null;
	carb_g: number | null;
	fat_g: number | null;
}

export interface Me {
	id: number;
	name: string;
	email: string | null;
	targets: Targets;
	today: string;
	timezone: string;
}

export interface Serving {
	label: string;
	grams: number;
	default: boolean;
}

export type Source = 'ours' | 'sgfoodid' | 'usda';

export interface Food {
	id: number;
	source: Source;
	source_label: string;
	name: string;
	brand: string | null;
	description: string | null;
	category: string | null;
	per_100g: Nutrients;
	servings: Serving[];
	aliases: string[];
	editable: boolean;
}

export interface Entry extends Nutrients {
	id: number;
	date: string;
	meal: Meal;
	food_id: number | null;
	name: string;
	portion: string;
	servings: number | null;
	serving_label: string | null;
	grams: number | null;
	is_estimate: boolean;
	note: string | null;
	photo_id: number | null;
	origin: string;
}

export interface Day {
	date: string;
	meals: Record<Meal, Entry[]>;
	meal_totals: Record<Meal, Nutrients>;
	totals: Nutrients;
	targets: Targets;
}

export interface QuickItem {
	id?: number;
	food_id: number;
	name: string;
	serving_label: string | null;
	servings: number | null;
	grams: number | null;
	kcal: number | null;
}

export interface SavedMealItem {
	food_id: number;
	serving_label: string | null;
	servings: number | null;
	grams: number | null;
	name?: string;
}

export interface SavedMeal {
	id: number;
	name: string;
	items: SavedMealItem[];
}

export interface Quick {
	pins: QuickItem[];
	saved_meals: SavedMeal[];
	frequent: QuickItem[];
	recent: QuickItem[];
	yesterday: {
		date: string;
		items: { entry_id: number; name: string; kcal: number | null }[];
		kcal: number;
	} | null;
}

export interface TurnChange {
	table: 'entries' | 'foods';
	action: 'create' | 'update' | 'delete';
	row_id: number;
	name: string | null;
	kcal: number | null;
}

export interface Turn {
	id: number;
	user_text: string;
	photo_id: number | null;
	reply_text: string;
	status: string;
	undone: boolean;
	changes: TurnChange[];
	cost_usd: number;
	created_at: string;
}

export interface HistoryDay extends Nutrients {
	date: string;
	entries: number;
}

export interface History {
	days: HistoryDay[];
	targets: Targets;
}

export interface Usage {
	month_usd: number;
	turns: number;
	model: string;
}

export interface Portion {
	unit: string; // a serving label, or 'g'
	count: number;
	grams: number;
}

export interface FoodDraft {
	name: string;
	brand: string;
	description: string;
	aliases: string[];
	basis: 'per_100g' | 'per_serving';
	serving_grams: number | null;
	nutrients: Record<NutrientKey, number | null>;
	servings: Serving[];
}
