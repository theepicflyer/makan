<script lang="ts">
	import BarChart from './BarChart.svelte';
	import type { HistoryDay, Targets } from '../types.ts';
	import { grams } from '../format.ts';
	import { dayAxisLabel, loggedAverage, shortDate } from '../history.ts';

	/* Protein, carbs and fat a day, one small chart each against its own target, sharing the hover. */
	let { days, targets, onpick }: { days: HistoryDay[]; targets: Targets; onpick?: (day: HistoryDay) => void } = $props();

	const id = $props.id();
	let active = $state<number | null>(null);

	const MACROS = [
		{ key: 'protein_g', label: 'Protein', color: 'var(--protein)', target: () => targets.protein_g },
		{ key: 'carb_g', label: 'Carbs', color: 'var(--carbs)', target: () => targets.carb_g },
		{ key: 'fat_g', label: 'Fat', color: 'var(--fat)', target: () => targets.fat_g }
	] as const;

	const axis = $derived(days.map((d) => dayAxisLabel(d.date, days.length)));
	const day = $derived(active != null ? days[active] : null);
</script>

<section class="bh-card" aria-labelledby="{id}-title">
	<header class="bh-card__head mb-2">
		<h2 id="{id}-title" class="bh-card__title">Macros per day</h2>
		<span class="small text-ink-muted">{day ? shortDate(day.date) : 'grams, logged days'}</span>
	</header>
	<div class="grid gap-3" data-chart-group>
		{#each MACROS as m, k (m.key)}
			{@const target = m.target()}
			{@const last = k === MACROS.length - 1}
			<div>
				<div class="flex items-baseline justify-between gap-2 px-1">
					<span class="label"><span class="mk-dot" style="background: {m.color}"></span>{m.label}</span>
					<span class="small bh-num text-ink-muted">
						{#if day}
							<b class="text-ink">{day.entries ? `${grams(day[m.key])} g` : 'Not logged'}</b>
						{:else}
							<b class="text-ink">{grams(loggedAverage(days, m.key))} g</b> average
						{/if}
						{#if target}· target {grams(target)} g{/if}
					</span>
				</div>
				<BarChart
					bars={days.map((d, i) => ({
						key: d.date,
						value: d.entries ? (d[m.key] ?? 0) : null,
						label: axis[i],
						aria: `${shortDate(d.date)}: ${d.entries ? `${grams(d[m.key])} g ${m.label.toLowerCase()}` : 'not logged'}`
					}))}
					height={last ? 112 : 86}
					axis={last}
					color={m.color}
					{target}
					bind:active
					label="{m.label} a day{target ? ` against a ${Math.round(target)} g target` : ''}"
					onpick={onpick && ((i) => onpick(days[i]))}
				/>
			</div>
		{/each}
	</div>
</section>
