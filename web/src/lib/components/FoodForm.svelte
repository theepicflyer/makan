<script lang="ts">
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

<div class="space-y-5">
	<div class="grid gap-3">
		<label class="block"><span class="label">Name</span><input class="field" bind:value={draft.name} placeholder="e.g. Greek Light Yogurt" required /></label>
		<label class="block"><span class="label">Brand</span><input class="field" bind:value={draft.brand} placeholder="Optional" /></label>
	</div>

	<div>
		<span class="label">Answers to</span>
		<div class="flex flex-wrap gap-1.5">
			{#each draft.aliases as alias (alias)}
				<span class="inline-flex h-8 items-center gap-1 rounded-full bg-wash pr-1 pl-3 text-[14px]">
					{alias}
					<button
						class="grid h-7 w-7 place-items-center rounded-full text-ink-2 hover:bg-wash"
						aria-label="Remove {alias}"
						onclick={() => (draft.aliases = draft.aliases.filter((a) => a !== alias))}
					>
						<svg width="10" height="10" viewBox="0 0 16 16" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
					</button>
				</span>
			{/each}
		</div>
		<div class="mt-2 flex gap-2">
			<input
				class="field"
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
			<button class="btn btn-ghost" onclick={addAlias} disabled={!aliasInput.trim()}>Add</button>
		</div>
		<p class="mt-1.5 text-[13px] text-muted">Generic words that should mean this food, so "a bowl of yogurt" picks it.</p>
	</div>

	<div>
		<div class="mb-2 flex items-center justify-between gap-2">
			<span class="label mb-0">Nutrition</span>
			<div class="grid grid-cols-2 gap-1 rounded-full bg-wash p-1 text-[13px]" role="radiogroup" aria-label="Nutrition basis">
				<button role="radio" aria-checked={draft.basis === 'per_100g'} class="min-h-9 rounded-full px-3 font-medium {draft.basis === 'per_100g' ? 'bg-segment shadow-sm' : 'text-ink-2'}" onclick={() => setBasis('per_100g')}>Per 100 g</button>
				<button role="radio" aria-checked={draft.basis === 'per_serving'} class="min-h-9 rounded-full px-3 font-medium {draft.basis === 'per_serving' ? 'bg-segment shadow-sm' : 'text-ink-2'}" onclick={() => setBasis('per_serving')}>Per serving</button>
			</div>
		</div>
		{#if draft.basis === 'per_serving'}
			<label class="mb-3 block"><span class="label">Serving size (g)</span><input class="field tabular" type="number" inputmode="decimal" min="1" bind:value={draft.serving_grams} /></label>
		{/if}
		<div class="grid grid-cols-2 gap-3">
			{#each FIELDS as f (f.key)}
				<label class="block">
					<span class="label">{f.label} <span class="font-normal text-muted">({f.unit})</span></span>
					<input class="field tabular" type="number" inputmode="decimal" min="0" step="any" bind:value={draft.nutrients[f.key]} required={f.key === 'kcal'} />
				</label>
			{/each}
		</div>
	</div>

	<div>
		<span class="label">Servings</span>
		<div class="space-y-2">
			{#each draft.servings as s, i (i)}
				<div class="flex items-center gap-2">
					<input class="field min-w-0 flex-1" bind:value={s.label} placeholder="tub, bowl, slice" aria-label="Serving name" />
					<input class="field tabular w-24" type="number" inputmode="decimal" min="1" bind:value={s.grams} aria-label="Grams" />
					<span class="text-[13px] text-muted">g</span>
					<button
						class="grid h-11 w-11 shrink-0 place-items-center rounded-full {s.default ? 'text-ink' : 'text-muted'}"
						aria-label={s.default ? 'Default serving' : 'Make default'}
						aria-pressed={s.default}
						title="Default serving"
						onclick={() => setDefault(i)}
					>
						<svg width="18" height="18" viewBox="0 0 24 24" fill={s.default ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" /></svg>
					</button>
					<button class="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted hover:bg-wash" aria-label="Remove serving" onclick={() => removeServing(i)}>
						<svg width="14" height="14" viewBox="0 0 16 16" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
					</button>
				</div>
			{/each}
		</div>
		<button class="btn btn-ghost mt-2 min-h-10 text-sm" onclick={addServing}>Add serving</button>
	</div>
</div>
