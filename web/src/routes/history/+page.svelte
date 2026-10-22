<script lang="ts">
	import KcalChart from '#lib/components/KcalChart.svelte';
	import MacrosCard from '#lib/components/MacrosCard.svelte';
	import Habitat from '#lib/burrow/Habitat.svelte';
	import Icon from '#lib/burrow/Icon.svelte';
	import Loader from '#lib/burrow/Loader.svelte';
	import TrailPath from '#lib/burrow/TrailPath.svelte';
	import TunnelRow from '#lib/burrow/TunnelRow.svelte';
	import { get } from '#lib/api.ts';
	import { addDays, dayLabel, kcal, parseDate } from '#lib/format.ts';
	import type { History } from '#lib/types.ts';
	import { session } from '#lib/state.svelte.ts';

	let range = $state<14 | 30>(14);
	let data = $state<History | null>(null);
	let loading = $state(false);
	const today = $derived(session.me?.today ?? '');

	$effect(() => {
		const r = range;
		const end = today;
		if (!end) return;
		loading = true;
		get<History>(`/api/history?start=${addDays(end, -(r - 1))}&end=${end}`)
			.then((h) => (data = h))
			.finally(() => (loading = false));
	});

	const logged = $derived(data ? data.days.filter((d) => d.entries > 0) : []);
	const avg = (k: 'kcal' | 'protein_g' | 'carb_g' | 'fat_g') =>
		logged.length ? logged.reduce((s, d) => s + (d[k] ?? 0), 0) / logged.length : 0;
	const onTarget = $derived(
		data?.targets.kcal ? logged.filter((d) => (d.kcal ?? 0) <= (data?.targets.kcal ?? 0)).length : null
	);
	const newestFirst = $derived(data ? [...data.days].reverse() : []);

	function chamberTitle(iso: string): string {
		const rel = dayLabel(iso, today);
		return ['Today', 'Yesterday'].includes(rel) ? rel : parseDate(iso).toLocaleDateString('en-SG', { weekday: 'long' });
	}
</script>

<svelte:head><title>History · makan</title></svelte:head>

<Habitat kind="burrow" mood={loading ? 'busy' : 'happy'} class="mk-top">
	<p class="small text-ink-muted">Your last {range} days</p>
	<h1 class="page-title">History</h1>
</Habitat>

<div class="mk-page">
	<div class="mk-choice pt-4" role="radiogroup" aria-label="Range">
		{#each [14, 30] as r (r)}
			<button role="radio" aria-checked={range === r} class="bh-chip {range === r ? 'is-selected' : ''}" onclick={() => (range = r as 14 | 30)}>
				{#if range === r}<Icon name="check" size={16} />{/if}{r} days
			</button>
		{/each}
	</div>

	{#if data}
		<div class="transition-opacity {loading ? 'opacity-50' : ''}">
			<!-- Gali's footprints wind down behind the cards and into the tunnel -->
			<TrailPath kind="footprints" from={0.62} toPx={32} seed={2} class="grid gap-9 py-9">
				<section class="bh-card grid grid-cols-3 gap-3" aria-label="Summary">
					<div>
						<div class="label text-ink-muted">Avg kcal</div>
						<div class="card-title bh-num mt-1">{logged.length ? kcal(avg('kcal')) : '–'}</div>
						<div class="small text-ink-muted">logged days</div>
					</div>
					<div>
						<div class="label text-ink-muted">Days logged</div>
						<div class="card-title bh-num mt-1">{logged.length}<span class="small text-ink-muted">{` / ${range}`}</span></div>
					</div>
					<div>
						<div class="label text-ink-muted">At or under</div>
						<div class="card-title bh-num mt-1">
							{onTarget ?? '–'}<span class="small text-ink-muted">{onTarget != null ? ` / ${logged.length}` : ''}</span>
						</div>
						<div class="small text-ink-muted">target</div>
					</div>
				</section>

				<section class="bh-card px-3 pb-2" aria-labelledby="chart-title">
					<header class="bh-card__head mb-1 px-1">
						<h2 id="chart-title" class="bh-card__title">Daily calories</h2>
					</header>
					<KcalChart days={data.days} target={data.targets.kcal} {today} />
					<p class="small px-1 pb-1 text-ink-muted">Dots mark days with nothing logged.</p>
				</section>

				<MacrosCard
					title="Average macros"
					note="logged days"
					protein={avg('protein_g')}
					carbs={avg('carb_g')}
					fat={avg('fat_g')}
					targets={data.targets}
					empty={logged.length ? undefined : 'Nothing logged in this range yet.'}
				/>
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
								<span class="small bh-num flex flex-wrap gap-x-3 text-ink-muted">
									<span><span class="mk-dot" style="background: var(--protein)"></span>P {Math.round(d.protein_g ?? 0)} g</span>
									<span><span class="mk-dot" style="background: var(--carbs)"></span>C {Math.round(d.carb_g ?? 0)} g</span>
									<span><span class="mk-dot" style="background: var(--fat)"></span>F {Math.round(d.fat_g ?? 0)} g</span>
								</span>
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
