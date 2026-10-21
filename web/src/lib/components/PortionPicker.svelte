<script lang="ts">
	import type { Food, Portion } from '../types.ts';
	import { kcal, grams as fmtG, qty, scale, portionGrams } from '../format.ts';

	let { food, value = $bindable() }: { food: Food; value: Portion } = $props();

	const totalGrams = $derived(portionGrams(food, value));
	const n = $derived(scale(food.per_100g, totalGrams || 0));

	function pick(unit: string) {
		if (unit === value.unit) return;
		if (unit === 'g') value = { unit, count: value.count, grams: Math.round(totalGrams) || 100 };
		else value = { unit, count: 1, grams: value.grams };
	}

	function step(delta: number) {
		const base = Number(value.count) || 1;
		const next = Math.max(0.25, delta >= 1 || delta <= -1 ? Math.round(base + delta) || 1 : Math.round((base + delta) * 4) / 4);
		value = { ...value, count: next };
	}
</script>

<div class="space-y-3">
	<div class="flex flex-wrap gap-2" role="radiogroup" aria-label="Portion unit">
		{#each food.servings as s (s.label)}
			<button
				role="radio"
				aria-checked={value.unit === s.label}
				class="min-h-11 rounded-full border px-3 text-sm {value.unit === s.label
					? 'border-ink bg-ink text-surface'
					: 'border-line bg-surface-2 text-ink'}"
				onclick={() => pick(s.label)}
			>
				{s.label.replace(/^1 /, '').replace(/\((s|es)\)/g, '')} <span class="opacity-70">· {qty(s.grams)} g</span>
			</button>
		{/each}
		<button
			role="radio"
			aria-checked={value.unit === 'g'}
			class="min-h-11 rounded-full border px-3 text-sm {value.unit === 'g'
				? 'border-ink bg-ink text-surface'
				: 'border-line bg-surface-2 text-ink'}"
			onclick={() => pick('g')}>grams</button
		>
	</div>

	{#if value.unit === 'g'}
		<label class="block">
			<span class="label">Weight (g)</span>
			<input
				class="field tabular"
				type="number"
				inputmode="decimal"
				min="1"
				step="1"
				bind:value={value.grams}
			/>
		</label>
	{:else}
		<div class="flex items-center gap-3">
			<span class="label mb-0">How many</span>
			<div class="ml-auto flex items-center gap-1">
				<button class="btn btn-ghost w-11 px-0 text-xl" aria-label="Less" onclick={() => step(value.count > 1 ? -1 : -0.25)}>−</button>
				<input
					class="field tabular w-20 text-center"
					type="number"
					inputmode="decimal"
					min="0.25"
					step="0.25"
					aria-label="Servings"
					bind:value={value.count}
				/>
				<button class="btn btn-ghost w-11 px-0 text-xl" aria-label="More" onclick={() => step(value.count >= 1 ? 1 : 0.25)}>+</button>
			</div>
		</div>
	{/if}

	<div class="rounded-xl bg-wash px-3 py-2.5 text-sm">
		<span class="text-lg font-semibold">{kcal(n.kcal)}</span> kcal
		<span class="text-muted">· {Math.round(totalGrams || 0)} g</span>
		<div class="mt-0.5 flex gap-3 text-[13px] text-ink-2">
			<span><span class="inline-block h-2 w-2 rounded-full bg-protein"></span> P {fmtG(n.protein_g)}</span>
			<span><span class="inline-block h-2 w-2 rounded-full bg-carb"></span> C {fmtG(n.carb_g)}</span>
			<span><span class="inline-block h-2 w-2 rounded-full bg-fat"></span> F {fmtG(n.fat_g)}</span>
		</div>
	</div>
</div>
