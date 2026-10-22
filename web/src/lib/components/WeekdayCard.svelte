<script lang="ts">
	import BarChart from './BarChart.svelte';
	import NutrientIcon from './NutrientIcon.svelte';
	import type { HistoryDay } from '../types.ts';
	import { kcal } from '../format.ts';
	import { weekdayKcal } from '../history.ts';

	let { days, target, height = 200 }: { days: HistoryDay[]; target: number | null; height?: number } = $props();

	const id = $props.id();
	const week = $derived(weekdayKcal(days));
</script>

<section class="bh-card" aria-labelledby="{id}-title">
	<header class="bh-card__head mb-2">
		<h2 id="{id}-title" class="bh-card__title">By weekday</h2>
		<span class="small text-ink-muted">average kcal</span>
	</header>
	<BarChart
		bars={week.map((w) => ({
			key: w.name,
			value: w.avg,
			label: w.name.slice(0, 3),
			aria: `${w.name}s: ${w.avg != null ? `${kcal(w.avg)} kcal on average over ${w.count} day${w.count === 1 ? '' : 's'}` : 'nothing logged'}`
		}))}
		{height}
		{target}
		floor={500}
		label="Average calories on each weekday{target ? ` against a ${Math.round(target)} kcal target` : ''}"
	>
		{#snippet tip(i)}
			{@const w = week[i]}
			<div class="text-ink-muted">{w.name}s</div>
			{#if w.avg != null}
				<div class="body-strong bh-num"><NutrientIcon kind="energy" />{kcal(w.avg)} kcal</div>
				<div class="text-ink-muted">average of {w.count} day{w.count === 1 ? '' : 's'}</div>
			{:else}
				<div class="body-strong">Not logged</div>
			{/if}
		{/snippet}
	</BarChart>
</section>
