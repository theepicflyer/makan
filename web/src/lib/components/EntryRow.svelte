<script lang="ts">
	import Trace from '../burrow/Trace.svelte';
	import { MEAL_TRACE, type Entry } from '../types.ts';
	import { entryPortion, grams, kcal } from '../format.ts';

	let { entry, onclick }: { entry: Entry; onclick: () => void } = $props();
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
		<span class="bh-row__sub truncate">
			{entryPortion(entry.servings, entry.serving_label, entry.grams) || '–'} · P {grams(entry.protein_g)} · C {grams(entry.carb_g)} · F {grams(entry.fat_g)}
		</span>
	</span>
	<span class="bh-row__amount">{kcal(entry.kcal)}</span>
</button>
