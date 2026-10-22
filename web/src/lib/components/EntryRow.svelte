<script lang="ts">
	import MacroAmounts from './MacroAmounts.svelte';
	import NutrientIcon from './NutrientIcon.svelte';
	import Trace from '../burrow/Trace.svelte';
	import { MEAL_TRACE, type Entry } from '../types.ts';
	import { entryPortion, kcal } from '../format.ts';

	let { entry, onclick }: { entry: Entry; onclick: () => void } = $props();

	const portion = $derived(entryPortion(entry.servings, entry.serving_label, entry.grams));
</script>

<button class="bh-row mk-row-btn" {onclick}>
	<span class="bh-row__tile">
		{#if entry.photo_id}
			<img src="/api/photos/{entry.photo_id}" alt="" loading="lazy" class="mk-tile-photo" />
		{:else}
			<Trace name={MEAL_TRACE[entry.meal]} size={30} />
		{/if}
	</span>
	<span class="bh-row__text">
		<span class="flex min-w-0 items-center gap-1.5">
			<span class="bh-row__title min-w-0">{entry.name}</span>
			{#if entry.is_estimate}<span class="mk-badge" title="Estimated">est.</span>{/if}
		</span>
		<!-- the portion, then the macros; on a narrow phone a long portion pushes the macros onto a second line -->
		<span class="bh-row__sub flex flex-wrap items-baseline gap-x-2">
			{#if portion}<span class="min-w-0 truncate">{portion}</span>{/if}
			<MacroAmounts protein={entry.protein_g} carbs={entry.carb_g} fat={entry.fat_g} />
		</span>
	</span>
	<span class="bh-row__amount"><NutrientIcon kind="energy" labelled />{kcal(entry.kcal)}</span>
</button>
