<script lang="ts">
	import Meter from '../burrow/Meter.svelte';
	import type { Targets } from '../types.ts';

	let {
		title = 'Macros',
		note,
		protein,
		carbs,
		fat,
		targets,
		empty
	}: {
		title?: string;
		note?: string;
		protein: number;
		carbs: number;
		fat: number;
		targets: Targets;
		/** Shown instead of the meters when there is nothing to average. */
		empty?: string;
	} = $props();

	const id = $props.id();
</script>

<section class="bh-card" aria-labelledby="{id}-title">
	<header class="bh-card__head">
		<h2 id="{id}-title" class="bh-card__title">{title}</h2>
		{#if note}<span class="small text-ink-muted">{note}</span>{/if}
	</header>
	{#if empty}
		<p class="body text-ink-muted">{empty}</p>
	{:else}
		<div class="grid gap-3.5">
			<Meter label="Protein" value={protein} max={targets.protein_g} color="protein" cap="sunflower" nutrient="protein" />
			<Meter label="Carbs" value={carbs} max={targets.carb_g} color="carbs" cap="sunflower" nutrient="carbs" />
			<Meter label="Fat" value={fat} max={targets.fat_g} color="fat" cap="sunflower" nutrient="fat" />
		</div>
	{/if}
</section>
