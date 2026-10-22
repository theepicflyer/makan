<script lang="ts">
	import { goto } from '$app/navigation';
	import { MediaQuery } from 'svelte/reactivity';
	import DayTable from '#lib/components/DayTable.svelte';
	import KcalChart from '#lib/components/KcalChart.svelte';
	import MacroDays from '#lib/components/MacroDays.svelte';
	import MacroAmounts from '#lib/components/MacroAmounts.svelte';
	import MacrosCard from '#lib/components/MacrosCard.svelte';
	import NutrientIcon, { type Nutrient } from '#lib/components/NutrientIcon.svelte';
	import WeekdayCard from '#lib/components/WeekdayCard.svelte';
	import Habitat from '#lib/burrow/Habitat.svelte';
	import Icon from '#lib/burrow/Icon.svelte';
	import Loader from '#lib/burrow/Loader.svelte';
	import TrailPath from '#lib/burrow/TrailPath.svelte';
	import TunnelRow from '#lib/burrow/TunnelRow.svelte';
	import { get } from '#lib/api.ts';
	import { addDays, dayLabel, kcal, parseDate } from '#lib/format.ts';
	import { loggedAverage, rollingKcal, spanLabel } from '#lib/history.ts';
	import type { History, HistoryDay } from '#lib/types.ts';
	import { session, wide } from '#lib/state.svelte.ts';

	type Range = 14 | 30 | 90;
	const RANGES: Range[] = [14, 30, 90];
	// from 1280px the charts have the averages beside them (Tailwind's xl)
	const roomy = new MediaQuery('min-width: 1280px', false);
	// days fetched before the range so its first week has a full 7-day average
	const LEAD = 6;

	let range = $state<Range>(14);
	let end = $state('');
	let data = $state<History | null>(null);
	let loading = $state(false);
	let seq = 0;
	const today = $derived(session.me?.today ?? '');
	const last = $derived(end || today);
	const start = $derived(last ? addDays(last, -(range - 1)) : '');

	$effect(() => {
		const from = start;
		const to = last;
		if (!to) return;
		const mine = ++seq;
		loading = true;
		get<History>(`/api/history?start=${addDays(from, -LEAD)}&end=${to}`)
			.then((h) => {
				if (mine === seq) data = h;
			})
			.finally(() => {
				if (mine === seq) loading = false;
			});
	});

	const days = $derived(data ? data.days.slice(LEAD) : []);
	const trend = $derived(data && range > 14 ? rollingKcal(data.days, LEAD) : undefined);
	const logged = $derived(days.filter((d) => d.entries > 0));
	const avg = (k: 'kcal' | 'protein_g' | 'carb_g' | 'fat_g') => loggedAverage(days, k) ?? 0;
	const onTarget = $derived(
		data?.targets.kcal ? logged.filter((d) => (d.kcal ?? 0) <= (data?.targets.kcal ?? 0)).length : null
	);
	const avgDelta = $derived(logged.length && data?.targets.kcal ? avg('kcal') - data.targets.kcal : null);
	const newestFirst = $derived([...days].reverse());
	const current = $derived(last === today);

	function shift(by: number) {
		const next = addDays(last, by);
		end = next >= today ? '' : next;
	}

	function openDay(d: HistoryDay) {
		goto(`/day/${d.date}`);
	}

	function chamberTitle(iso: string): string {
		const rel = dayLabel(iso, today);
		return ['Today', 'Yesterday'].includes(rel) ? rel : parseDate(iso).toLocaleDateString('en-SG', { weekday: 'long' });
	}
</script>

<svelte:head><title>History · makan</title></svelte:head>

{#snippet tile(label: string, value: string, of?: string, note?: string, nutrient?: Nutrient)}
	<div>
		<div class="label text-ink-muted">{#if nutrient}<NutrientIcon kind={nutrient} size={14} />{/if}{label}</div>
		<div class="card-title bh-num mt-1">{value}{#if of}<span class="small text-ink-muted">{` / ${of}`}</span>{/if}</div>
		{#if note}<div class="small text-ink-muted">{note}</div>{/if}
	</div>
{/snippet}

{#snippet calories(height: number)}
	{#if data}
		<section class="bh-card px-3 pb-2" aria-labelledby="chart-title">
			<header class="bh-card__head mb-1 px-1">
				<h2 id="chart-title" class="bh-card__title">Daily calories</h2>
			</header>
			<KcalChart {days} target={data.targets.kcal} {today} {trend} {height} onpick={wide.current ? openDay : undefined} />
			<p class="small px-1 pb-1 text-ink-muted">
				Dots mark days with nothing logged.{#if wide.current}&nbsp;Select a bar to open that day.{/if}
			</p>
		</section>
	{/if}
{/snippet}

{#snippet macros()}
	{#if data}
		<MacrosCard
			title="Average macros"
			note="logged days"
			protein={avg('protein_g')}
			carbs={avg('carb_g')}
			fat={avg('fat_g')}
			targets={data.targets}
			empty={logged.length ? undefined : 'Nothing logged in this range yet.'}
		/>
	{/if}
{/snippet}

{#snippet split()}
	<!-- the share of calories from each macro (4, 4 and 9 kcal a gram), against the split the targets make -->
	{@const parts = [
		{ kind: 'protein', label: 'Protein', color: 'var(--protein)', kcal: avg('protein_g') * 4, target: (data?.targets.protein_g ?? 0) * 4 },
		{ kind: 'carbs', label: 'Carbs', color: 'var(--carbs)', kcal: avg('carb_g') * 4, target: (data?.targets.carb_g ?? 0) * 4 },
		{ kind: 'fat', label: 'Fat', color: 'var(--fat)', kcal: avg('fat_g') * 9, target: (data?.targets.fat_g ?? 0) * 9 }
	] as const}
	{@const total = parts.reduce((s, p) => s + p.kcal, 0)}
	{@const targetTotal = parts.reduce((s, p) => s + p.target, 0)}
	<section class="bh-card" aria-labelledby="split-title">
		<header class="bh-card__head mb-2">
			<h2 id="split-title" class="bh-card__title">Where calories come from</h2>
		</header>
		{#if total > 0}
			<div class="flex h-5 gap-[2px] overflow-hidden rounded-[var(--radius-pill)] border-2 border-outline bg-surface" aria-hidden="true">
				{#each parts as p (p.label)}
					<span style="flex: {p.kcal} 0 0; background: {p.color}"></span>
				{/each}
			</div>
			<div class="mt-3 grid grid-cols-3 gap-2">
				{#each parts as p (p.label)}
					<div>
						<div class="label"><NutrientIcon kind={p.kind} size={14} />{p.label}</div>
						<div class="body-strong bh-num mt-0.5">{Math.round((p.kcal / total) * 100)}%</div>
						{#if targetTotal > 0}<div class="small bh-num text-ink-muted">target {Math.round((p.target / targetTotal) * 100)}%</div>{/if}
					</div>
				{/each}
			</div>
		{:else}
			<p class="body text-ink-muted">Nothing logged in this range yet.</p>
		{/if}
	</section>
{/snippet}

<Habitat kind="burrow" mood={loading ? 'busy' : 'happy'} class="mk-top">
	<p class="small text-ink-muted">{current ? `Your last ${range} days` : spanLabel(start, last, today)}</p>
	<h1 class="page-title">History</h1>
</Habitat>

<div class="mk-page">
	<!-- one row of controls scoping everything below: how many days, and which ones -->
	<div class="flex flex-wrap items-center gap-x-4 gap-y-3 pt-4 lg:pt-6">
		<div class="mk-choice" role="radiogroup" aria-label="Range">
			{#each RANGES as r (r)}
				<button role="radio" aria-checked={range === r} class="bh-chip {range === r ? 'is-selected' : ''}" onclick={() => (range = r)}>
					{#if range === r}<Icon name="check" size={16} />{/if}{r} days
				</button>
			{/each}
		</div>
		<div class="flex items-center gap-1.5">
			<button class="bh-btn bh-btn--secondary bh-btn--sm bh-btn--icon" aria-label="Earlier {range} days" onclick={() => shift(-range)}>
				<Icon name="chevron-left" size={18} />
			</button>
			<button class="bh-btn bh-btn--secondary bh-btn--sm bh-btn--icon" aria-label="Later {range} days" disabled={current} onclick={() => shift(range)}>
				<Icon name="chevron-right" size={18} />
			</button>
			<span class="small bh-num px-1 text-ink-muted">{start ? spanLabel(start, last, today) : ''}</span>
			{#if !current}
				<button class="bh-btn bh-btn--ghost bh-btn--sm" onclick={() => (end = '')}>Latest</button>
			{/if}
		</div>
	</div>

	{#if data && wide.current}
		<!-- desktop: the whole range at once, Gali's footprints winding behind the cards down to the table of days -->
		<div class="transition-opacity {loading ? 'opacity-50' : ''}">
			<TrailPath kind="footprints" from={0.3} to={0.5} seed={2} class="grid grid-cols-12 gap-9 py-9">
				<section class="bh-card col-span-12 grid grid-cols-4 gap-6" aria-label="Summary">
					{@render tile('Average calories', logged.length ? kcal(avg('kcal')) : '–', undefined, 'kcal a day, logged days', 'energy')}
					{#if avgDelta != null}
						{@render tile(
							'Against your target',
							kcal(Math.abs(avgDelta)),
							undefined,
							`kcal a day ${Math.round(avgDelta) > 0 ? 'over' : 'under'} ${kcal(data.targets.kcal)}`
						)}
					{:else}
						{@render tile('Against your target', '–', undefined, data.targets.kcal ? 'nothing logged yet' : 'no target set')}
					{/if}
					{@render tile('Days logged', `${logged.length}`, `${range}`)}
					{@render tile('At or under target', onTarget != null ? `${onTarget}` : '–', onTarget != null ? `${logged.length}` : undefined, 'logged days')}
				</section>
				<!-- charts beside the averages from 1280px; between 1024 and 1280 they stack and the averages pair up.
				     min-w-0: a chart measuring itself mustn't widen its column. -->
				<div class="col-span-12 grid min-w-0 grid-cols-1 xl:col-span-8">{@render calories(280)}</div>
				<div class="col-span-12 grid min-w-0 grid-cols-2 gap-9 xl:col-span-4 xl:grid-cols-1">
					{@render macros()}
					{@render split()}
				</div>
				<div class="col-span-12 grid min-w-0 grid-cols-1 xl:col-span-8"><MacroDays {days} targets={data.targets} onpick={openDay} /></div>
				<div class="col-span-12 grid min-w-0 grid-cols-1 xl:col-span-4">
					<WeekdayCard {days} target={data.targets.kcal} height={roomy.current ? 330 : 220} />
				</div>
				<div class="col-span-12 grid min-w-0 grid-cols-1" data-trail-end><DayTable {days} targets={data.targets} {today} /></div>
			</TrailPath>
		</div>
	{:else if data}
		<div class="transition-opacity {loading ? 'opacity-50' : ''}">
			<!-- Gali's footprints wind down behind the cards and into the tunnel -->
			<TrailPath kind="footprints" from={0.62} toPx={32} seed={2} class="grid gap-9 py-9">
				<section class="bh-card grid grid-cols-3 gap-3" aria-label="Summary">
					{@render tile('Avg kcal', logged.length ? kcal(avg('kcal')) : '–', undefined, 'logged days', 'energy')}
					{@render tile('Days logged', `${logged.length}`, `${range}`)}
					{@render tile('At or under', onTarget != null ? `${onTarget}` : '–', onTarget != null ? `${logged.length}` : undefined, 'target')}
				</section>
				{@render calories(180)}
				{@render macros()}
			</TrailPath>

			<!-- Gali's tunnel: a chamber per day, newest first, footprints between them -->
			<div class="bh-tunnel">
				{#each newestFirst as d, i (d.date)}
					{@const when = parseDate(d.date)}
					<TunnelRow
						day={`${when.getDate()}`}
						month={when.toLocaleDateString('en-SG', { month: 'short' }).toUpperCase()}
						title={d.entries ? `${chamberTitle(d.date)} · ${kcal(d.kcal)} kcal` : chamberTitle(d.date)}
						last={i === newestFirst.length - 1}
					>
						<a href="/day/{d.date}" class="bh-card block py-3 no-underline hover:bg-surface-sunk">
							{#if d.entries}
								<span class="small block text-ink-muted"><MacroAmounts protein={d.protein_g} carbs={d.carb_g} fat={d.fat_g} unit=" g" /></span>
								<span class="small mt-1 flex items-center gap-1 font-semibold text-sky-text">
									{d.entries} item{d.entries === 1 ? '' : 's'}<Icon name="chevron-right" size={16} />
								</span>
							{:else}
								<span class="small flex items-center gap-1 text-ink-muted">
									Not logged <span class="ml-auto flex items-center gap-1 font-semibold text-sky-text">Log it<Icon name="chevron-right" size={16} /></span>
								</span>
							{/if}
						</a>
					</TunnelRow>
				{/each}
			</div>
		</div>
	{:else}
		<div class="grid justify-items-center py-16"><Loader label="Digging up your history…" /></div>
	{/if}
</div>
