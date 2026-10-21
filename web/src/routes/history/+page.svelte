<script lang="ts">
	import KcalChart from '#lib/components/KcalChart.svelte';
	import Meter from '#lib/components/Meter.svelte';
	import { get } from '#lib/api.ts';
	import { addDays, kcal, parseDate } from '#lib/format.ts';
	import type { History } from '#lib/types.ts';
	import { session } from '#lib/state.svelte.ts';

	let range = $state<14 | 30>(14);
	let data = $state<History | null>(null);
	let showTable = $state(false);
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
</script>

<svelte:head><title>History · makan</title></svelte:head>

<header class="mb-3 flex items-center justify-between gap-2 pt-1">
	<h1 class="text-2xl font-semibold tracking-tight">History</h1>
	<div class="grid grid-cols-2 gap-1 rounded-full bg-wash p-1 text-[13px]" role="radiogroup" aria-label="Range">
		{#each [14, 30] as r (r)}
			<button role="radio" aria-checked={range === r} class="min-h-9 rounded-full px-3 font-medium {range === r ? 'bg-segment shadow-sm' : 'text-ink-2'}" onclick={() => (range = r as 14 | 30)}>{r} days</button>
		{/each}
	</div>
</header>

{#if data}
	<div class="space-y-3 transition-opacity {loading ? 'opacity-50' : ''}">
		<section class="grid grid-cols-3 gap-2">
			<div class="card px-3 py-3">
				<div class="text-[12px] font-medium text-ink-2">Avg kcal</div>
				<div class="mt-0.5 text-xl font-semibold">{logged.length ? kcal(avg('kcal')) : '–'}</div>
				<div class="text-[12px] text-muted">logged days</div>
			</div>
			<div class="card px-3 py-3">
				<div class="text-[12px] font-medium text-ink-2">Days logged</div>
				<div class="mt-0.5 text-xl font-semibold">{logged.length}<span class="text-sm font-normal text-muted"> / {range}</span></div>
			</div>
			<div class="card px-3 py-3">
				<div class="text-[12px] font-medium text-ink-2">At or under</div>
				<div class="mt-0.5 text-xl font-semibold">{onTarget ?? '–'}<span class="text-sm font-normal text-muted">{onTarget != null ? ` / ${logged.length}` : ''}</span></div>
				<div class="text-[12px] text-muted">target</div>
			</div>
		</section>

		<section class="card px-3 pt-3 pb-2">
			<div class="mb-1 flex items-baseline justify-between px-1">
				<h2 class="text-[15px] font-semibold">Daily calories</h2>
				<button class="min-h-9 text-[13px] text-ink-2 underline-offset-2 hover:underline" onclick={() => (showTable = !showTable)}>
					{showTable ? 'Hide table' : 'Show table'}
				</button>
			</div>
			<KcalChart days={data.days} target={data.targets.kcal} {today} />
			<p class="px-1 pb-1 text-[12px] text-muted">Dots mark days with nothing logged.</p>
			{#if showTable}
				<div class="mt-2 px-1">
					<table class="w-full text-[13px]">
						<thead class="text-ink-2">
							<tr><th class="py-1.5 text-left font-medium">Day</th><th class="text-right font-medium">kcal</th><th class="text-right font-medium">P</th><th class="text-right font-medium">C</th><th class="text-right font-medium">F</th></tr>
						</thead>
						<tbody class="tabular">
							{#each [...data.days].reverse() as d (d.date)}
								<tr class="border-t border-line">
									<td class="py-1.5"><a class="underline-offset-2 hover:underline" href="/day/{d.date}">{parseDate(d.date).toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short' })}</a></td>
									{#if d.entries}
										<td class="text-right">{kcal(d.kcal)}</td><td class="text-right">{Math.round(d.protein_g ?? 0)}</td><td class="text-right">{Math.round(d.carb_g ?? 0)}</td><td class="text-right">{Math.round(d.fat_g ?? 0)}</td>
									{:else}
										<td colspan="4" class="text-right text-muted">not logged</td>
									{/if}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>

		<section class="card p-4">
			<h2 class="mb-3 text-[15px] font-semibold">Average macros <span class="font-normal text-muted">· logged days</span></h2>
			{#if logged.length}
				<div class="grid grid-cols-3 gap-4">
					<Meter label="Protein" value={avg('protein_g')} target={data.targets.protein_g} color="var(--protein)" />
					<Meter label="Carbs" value={avg('carb_g')} target={data.targets.carb_g} color="var(--carb)" />
					<Meter label="Fat" value={avg('fat_g')} target={data.targets.fat_g} color="var(--fat)" />
				</div>
			{:else}
				<p class="text-[14px] text-muted">Nothing logged in this range yet.</p>
			{/if}
		</section>
	</div>
{:else}
	<div class="space-y-3"><div class="card h-20 animate-pulse"></div><div class="card h-56 animate-pulse"></div></div>
{/if}
