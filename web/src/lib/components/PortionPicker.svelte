<script lang="ts">
	import Icon from '../burrow/Icon.svelte';
	import Field from '../burrow/Field.svelte';
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

{#snippet unitChip(unit: string, text: string, detail?: string)}
	{@const selected = value.unit === unit}
	<button role="radio" aria-checked={selected} class="bh-chip {selected ? 'is-selected' : ''}" onclick={() => pick(unit)}>
		{#if selected}<Icon name="check" size={16} />{/if}
		{text}{#if detail}<span class="font-normal text-ink-muted">· {detail}</span>{/if}
	</button>
{/snippet}

<div class="space-y-4">
	<div class="mk-choice" role="radiogroup" aria-label="Portion unit">
		{#each food.servings as s (s.label)}
			{@render unitChip(s.label, s.label.replace(/^1 /, '').replace(/\((s|es)\)/g, ''), `${qty(s.grams)} g`)}
		{/each}
		{@render unitChip('g', 'grams')}
	</div>

	{#if value.unit === 'g'}
		<Field label="Weight" suffix="g" class="bh-num" type="number" inputmode="decimal" min="1" step="1" bind:value={value.grams} />
	{:else}
		<div class="flex items-center gap-3">
			<span class="bh-field__label">How many</span>
			<div class="ml-auto flex items-center gap-2">
				<button class="bh-btn bh-btn--secondary bh-btn--sm bh-btn--icon" aria-label="Less" onclick={() => step(value.count > 1 ? -1 : -0.25)}>
					<Icon name="minus" size={18} />
				</button>
				<span class="bh-field__box w-20">
					<input
						class="bh-field__input bh-num text-center"
						type="number"
						inputmode="decimal"
						min="0.25"
						step="0.25"
						aria-label="Servings"
						bind:value={value.count}
					/>
				</span>
				<button class="bh-btn bh-btn--secondary bh-btn--sm bh-btn--icon" aria-label="More" onclick={() => step(value.count >= 1 ? 1 : 0.25)}>
					<Icon name="plus" size={18} />
				</button>
			</div>
		</div>
	{/if}

	<div class="mk-well">
		<div class="flex items-baseline gap-1.5">
			<span class="card-title bh-num">{kcal(n.kcal)}</span><span class="small">kcal</span>
			<span class="small bh-num ml-auto text-ink-muted">{Math.round(totalGrams || 0)} g</span>
		</div>
		<div class="small bh-num mt-1 flex flex-wrap gap-x-4 text-ink-muted">
			<span><span class="mk-dot" style="background: var(--protein)"></span>Protein {fmtG(n.protein_g)} g</span>
			<span><span class="mk-dot" style="background: var(--carbs)"></span>Carbs {fmtG(n.carb_g)} g</span>
			<span><span class="mk-dot" style="background: var(--fat)"></span>Fat {fmtG(n.fat_g)} g</span>
		</div>
	</div>
</div>
