<script lang="ts">
	import BarChart from './BarChart.svelte';
	import type { HistoryDay } from '../types.ts';
	import { kcal } from '../format.ts';
	import { dayAria, dayAxisLabel, shortDate } from '../history.ts';

	let {
		days,
		target,
		today,
		trend,
		height = 180,
		onpick
	}: {
		days: HistoryDay[];
		target: number | null;
		today: string;
		/** The 7-day average, one value per day. */
		trend?: (number | null)[];
		height?: number;
		onpick?: (day: HistoryDay) => void;
	} = $props();

	// sticker bars: the sunflower's petal colour, today in makan's tomato
	const bars = $derived(
		days.map((d) => ({
			key: d.date,
			value: d.entries ? (d.kcal ?? 0) : null,
			label: dayAxisLabel(d.date, days.length),
			accent: d.date === today,
			aria: dayAria(d)
		}))
	);
</script>

{#if target || trend}
	<div class="label mb-1 flex flex-wrap items-center justify-end gap-x-4 gap-y-1 px-1 text-ink-muted">
		{#if trend}
			<span class="flex items-center gap-1.5">
				<svg width="18" height="4" aria-hidden="true"><line x1="1.5" x2="16.5" y1="2" y2="2" stroke="var(--sky-text)" stroke-width="2.5" stroke-linecap="round" /></svg>7-day average
			</span>
		{/if}
		{#if target}
			<span class="flex items-center gap-1.5">
				<svg width="18" height="4" aria-hidden="true"><line x1="1" x2="17" y1="2" y2="2" stroke="var(--ink)" stroke-width="2" stroke-dasharray="4 3" stroke-linecap="round" /></svg>Target {kcal(
					target
				)} kcal
			</span>
		{/if}
	</div>
{/if}
<BarChart
	{bars}
	{height}
	{target}
	line={trend}
	floor={500}
	label="Daily calories{target ? ` against a ${Math.round(target)} kcal target` : ''}"
	onpick={onpick && ((i) => onpick(days[i]))}
>
	{#snippet tip(i)}
		{@const d = days[i]}
		<div class="text-ink-muted">{shortDate(d.date)}</div>
		{#if d.entries}
			<div class="body-strong bh-num">{kcal(d.kcal)} kcal</div>
			<div class="bh-num mt-1 space-y-0.5 text-ink-muted">
				<div><span class="mk-dot" style="background: var(--protein)"></span><b class="text-ink">{Math.round(d.protein_g ?? 0)} g</b> protein</div>
				<div><span class="mk-dot" style="background: var(--carbs)"></span><b class="text-ink">{Math.round(d.carb_g ?? 0)} g</b> carbs</div>
				<div><span class="mk-dot" style="background: var(--fat)"></span><b class="text-ink">{Math.round(d.fat_g ?? 0)} g</b> fat</div>
			</div>
		{:else}
			<div class="body-strong">Not logged</div>
		{/if}
		{#if trend?.[i] != null}
			<div class="bh-num mt-1 border-t border-line pt-1 text-ink-muted"><b class="text-ink">{kcal(trend[i])}</b> 7-day average</div>
		{/if}
	{/snippet}
</BarChart>
