<script lang="ts">
	import Field from '../burrow/Field.svelte';
	import Icon from '../burrow/Icon.svelte';
	import { NUTRIENT_OF } from './NutrientIcon.svelte';
	import type { FoodDraft, NutrientKey } from '../types.ts';

	let { draft = $bindable() }: { draft: FoodDraft } = $props();

	let aliasInput = $state('');

	const FIELDS: { key: NutrientKey; label: string; unit: string }[] = [
		{ key: 'kcal', label: 'Calories', unit: 'kcal' },
		{ key: 'protein_g', label: 'Protein', unit: 'g' },
		{ key: 'carb_g', label: 'Carbs', unit: 'g' },
		{ key: 'fat_g', label: 'Fat', unit: 'g' },
		{ key: 'fibre_g', label: 'Fibre', unit: 'g' },
		{ key: 'sugar_g', label: 'Sugar', unit: 'g' },
		{ key: 'sodium_mg', label: 'Sodium', unit: 'mg' },
		{ key: 'sat_fat_g', label: 'Sat. fat', unit: 'g' }
	];

	function addAlias() {
		const parts = aliasInput
			.split(',')
			.map((s) => s.trim().toLowerCase())
			.filter(Boolean);
		draft.aliases = [...new Set([...draft.aliases, ...parts])];
		aliasInput = '';
	}

	function setBasis(basis: 'per_100g' | 'per_serving') {
		if (basis === draft.basis) return;
		const g = draft.serving_grams;
		if (g && g > 0) {
			const factor = basis === 'per_serving' ? g / 100 : 100 / g;
			for (const f of FIELDS) {
				const v = draft.nutrients[f.key];
				if (v != null && v !== ('' as unknown)) draft.nutrients[f.key] = Math.round(Number(v) * factor * 100) / 100;
			}
		}
		draft.basis = basis;
	}

	function addServing() {
		draft.servings = [...draft.servings, { label: '', grams: 0, default: draft.servings.length === 0 }];
	}

	function removeServing(i: number) {
		const wasDefault = draft.servings[i].default;
		draft.servings = draft.servings.filter((_, j) => j !== i);
		if (wasDefault && draft.servings.length) draft.servings[0].default = true;
	}

	function setDefault(i: number) {
		draft.servings = draft.servings.map((s, j) => ({ ...s, default: i === j }));
	}
</script>

{#snippet basisChip(basis: 'per_100g' | 'per_serving', text: string)}
	{@const selected = draft.basis === basis}
	<button role="radio" aria-checked={selected} class="bh-chip {selected ? 'is-selected' : ''}" onclick={() => setBasis(basis)}>
		{#if selected}<Icon name="check" size={16} />{/if}{text}
	</button>
{/snippet}

<div class="space-y-5">
	<div class="grid gap-3">
		<Field label="Name" bind:value={draft.name} placeholder="e.g. Greek Light Yogurt" required />
		<Field label="Brand" bind:value={draft.brand} placeholder="Optional" />
	</div>

	<div>
		<span class="mk-section-label">Answers to</span>
		{#if draft.aliases.length}
			<div class="mk-choice mb-2">
				{#each draft.aliases as alias (alias)}
					<span class="bh-chip is-selected pr-1">
						{alias}
						<button
							class="grid h-7 w-7 place-items-center rounded-full hover:bg-surface"
							aria-label="Remove {alias}"
							onclick={() => (draft.aliases = draft.aliases.filter((a) => a !== alias))}
						>
							<Icon name="close" size={14} />
						</button>
					</span>
				{/each}
			</div>
		{/if}
		<div class="flex gap-2">
			<span class="bh-field__box min-w-0 flex-1">
				<input
					class="bh-field__input"
					bind:value={aliasInput}
					placeholder="e.g. yogurt"
					aria-label="Add a word this food answers to"
					onkeydown={(e) => {
						if (e.key === 'Enter' || e.key === ',') {
							e.preventDefault();
							addAlias();
						}
					}}
				/>
			</span>
			<button class="bh-btn bh-btn--secondary" onclick={addAlias} disabled={!aliasInput.trim()}>Add</button>
		</div>
		<p class="bh-field__hint mt-1.5">Generic words that should mean this food, so “a bowl of yogurt” picks it.</p>
	</div>

	<div>
		<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
			<span class="mk-section-label mb-0">Nutrition</span>
			<div class="mk-choice" role="radiogroup" aria-label="Nutrition basis">
				{@render basisChip('per_100g', 'Per 100 g')}
				{@render basisChip('per_serving', 'Per serving')}
			</div>
		</div>
		{#if draft.basis === 'per_serving'}
			<Field label="Serving size" suffix="g" class="mb-3" type="number" inputmode="decimal" min="1" bind:value={draft.serving_grams} />
		{/if}
		<div class="grid grid-cols-2 gap-3">
			{#each FIELDS as f (f.key)}
				<Field
					label={f.label}
					nutrient={NUTRIENT_OF[f.key]}
					suffix={f.unit}
					type="number"
					inputmode="decimal"
					min="0"
					step="any"
					bind:value={draft.nutrients[f.key]}
					required={f.key === 'kcal'}
				/>
			{/each}
		</div>
	</div>

	<div>
		<span class="mk-section-label">Servings</span>
		<div class="space-y-2">
			{#each draft.servings as s, i (i)}
				<div class="flex items-center gap-1.5">
					<span class="bh-field__box min-w-0 flex-1">
						<input class="bh-field__input" bind:value={s.label} placeholder="tub, bowl, slice" aria-label="Serving name" />
					</span>
					<span class="bh-field__box w-24">
						<input class="bh-field__input bh-num" type="number" inputmode="decimal" min="1" bind:value={s.grams} aria-label="Grams" />
						<span class="bh-field__affix">g</span>
					</span>
					<button
						class="bh-btn bh-btn--ghost bh-btn--sm bh-btn--icon shrink-0 {s.default ? 'text-ink' : 'text-ink-muted'}"
						aria-label={s.default ? 'Default serving' : 'Make default'}
						aria-pressed={s.default}
						title="Default serving"
						onclick={() => setDefault(i)}
					>
						<Icon name="star" size={18} filled={s.default} />
					</button>
					<button class="bh-btn bh-btn--ghost bh-btn--sm bh-btn--icon shrink-0 text-ink-muted" aria-label="Remove serving" onclick={() => removeServing(i)}>
						<Icon name="close" size={16} />
					</button>
				</div>
			{/each}
		</div>
		<button class="bh-btn bh-btn--ghost bh-btn--sm -ml-3 mt-2" onclick={addServing}><Icon name="plus" size={18} />Add serving</button>
	</div>
</div>
