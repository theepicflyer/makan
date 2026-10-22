<script lang="ts">
	import { goto } from '$app/navigation';
	import Icon from '../burrow/Icon.svelte';
	import type { HistoryDay, NutrientKey, Targets } from '../types.ts';
	import { dayLabel, grams, kcal } from '../format.ts';
	import { loggedAverage } from '../history.ts';

	/* Every day of the range with all its totals, sortable by any column. Days with nothing logged sort last. */
	let { days, targets, today }: { days: HistoryDay[]; targets: Targets; today: string } = $props();

	type Col = 'date' | 'delta' | 'entries' | NutrientKey;
	const COLUMNS: { key: Col; label: string; dot?: string }[] = [
		{ key: 'date', label: 'Day' },
		{ key: 'kcal', label: 'Calories' },
		{ key: 'delta', label: 'vs target' },
		{ key: 'protein_g', label: 'Protein', dot: 'protein' },
		{ key: 'carb_g', label: 'Carbs', dot: 'carbs' },
		{ key: 'fat_g', label: 'Fat', dot: 'fat' },
		{ key: 'fibre_g', label: 'Fibre' },
		{ key: 'sugar_g', label: 'Sugar' },
		{ key: 'sodium_mg', label: 'Sodium' },
		{ key: 'entries', label: 'Items' }
	];
	const UNIT: Partial<Record<Col, string>> = { kcal: 'kcal', delta: 'kcal', sodium_mg: 'mg' };

	const id = $props.id();
	let sortKey = $state<Col>('date');
	let desc = $state(true);
	const columns = $derived(targets.kcal ? COLUMNS : COLUMNS.filter((c) => c.key !== 'delta'));

	function value(d: HistoryDay, key: Col): number | string | null {
		if (key === 'date') return d.date;
		if (key === 'entries') return d.entries;
		if (!d.entries) return null;
		if (key === 'delta') return targets.kcal ? (d.kcal ?? 0) - targets.kcal : null;
		return d[key];
	}

	const rows = $derived.by(() => {
		const dir = desc ? -1 : 1;
		return [...days].sort((a, b) => {
			const x = value(a, sortKey);
			const y = value(b, sortKey);
			if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
			return (x < y ? -1 : x > y ? 1 : 0) * dir;
		});
	});

	function sortBy(key: Col) {
		if (sortKey === key) desc = !desc;
		else {
			sortKey = key;
			desc = true;
		}
	}

	function cell(d: HistoryDay, key: Col): string {
		const v = value(d, key);
		if (v == null) return '–';
		if (key === 'kcal' || key === 'sodium_mg') return kcal(v as number);
		return grams(v as number);
	}

	const logged = $derived(days.filter((d) => d.entries > 0));
	const avgItems = $derived(logged.length ? logged.reduce((s, d) => s + d.entries, 0) / logged.length : null);

	const avgDelta = $derived.by(() => {
		const a = loggedAverage(days, 'kcal');
		return a != null && targets.kcal ? a - targets.kcal : null;
	});
</script>

{#snippet delta(v: number | null)}
	{#if v == null}
		–
	{:else if Math.round(v) > 0}
		<span class="font-semibold text-tomato-text">{kcal(v)} over</span>
	{:else if Math.round(v) < 0}
		<span class="text-ink-muted">{kcal(-v)} under</span>
	{:else}
		<span class="text-ink-muted">on target</span>
	{/if}
{/snippet}

<section class="bh-card" aria-labelledby="{id}-title">
	<header class="bh-card__head mb-2">
		<h2 id="{id}-title" class="bh-card__title">Every day</h2>
		<span class="small text-ink-muted">Select a column to sort</span>
	</header>
	<div class="-mx-2 overflow-x-auto">
		<table class="mk-table">
			<thead>
				<tr>
					{#each columns as c (c.key)}
						<th scope="col" aria-sort={sortKey === c.key ? (desc ? 'descending' : 'ascending') : undefined}>
							<button class="mk-sort" aria-pressed={sortKey === c.key} onclick={() => sortBy(c.key)}>
								{#if c.dot}<span class="mk-dot" style="background: var(--{c.dot})"></span>{/if}{c.label}{#if UNIT[c.key]}<span class="font-normal">&nbsp;{UNIT[c.key]}</span>{/if}
								{#if sortKey === c.key}<Icon name={desc ? 'arrow-down' : 'arrow-up'} size={14} />{/if}
							</button>
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each rows as d (d.date)}
					<!-- the whole row opens the day; its link is the way in for the keyboard -->
					<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
					<tr
						class="cursor-pointer"
						onclick={(e) => {
							if (!(e.target as Element).closest('a')) goto(`/day/${d.date}`);
						}}
					>
						{#each columns as c (c.key)}
							{#if c.key === 'date'}
								<td><a href="/day/{d.date}" class="mk-link {d.date === today ? '' : 'font-normal'}">{dayLabel(d.date, today)}</a></td>
							{:else if c.key === 'delta'}
								<td>{@render delta(value(d, 'delta') as number | null)}</td>
							{:else if c.key === 'kcal' && !d.entries}
								<td class="text-ink-muted">Not logged</td>
							{:else}
								<td class={c.key === 'kcal' ? 'font-semibold' : value(d, c.key) == null ? 'text-ink-muted' : ''}>{cell(d, c.key)}</td>
							{/if}
						{/each}
					</tr>
				{/each}
			</tbody>
			<tfoot>
				<tr>
					{#each columns as c (c.key)}
						{#if c.key === 'date'}
							<td class="font-semibold text-ink">Average</td>
						{:else if c.key === 'delta'}
							<td>{@render delta(avgDelta)}</td>
						{:else if c.key === 'entries'}
							<td>{avgItems == null ? '–' : Math.round(avgItems * 10) / 10}</td>
						{:else}
							<td class={c.key === 'kcal' ? 'font-semibold text-ink' : ''}>{c.key === 'kcal' || c.key === 'sodium_mg' ? kcal(loggedAverage(days, c.key)) : grams(loggedAverage(days, c.key))}</td>
						{/if}
					{/each}
				</tr>
				{#if targets.kcal || targets.protein_g || targets.carb_g || targets.fat_g}
					<tr>
						{#each columns as c (c.key)}
							{#if c.key === 'date'}
								<td>Target</td>
							{:else if c.key === 'kcal'}
								<td>{kcal(targets.kcal)}</td>
							{:else if c.key === 'protein_g' || c.key === 'carb_g' || c.key === 'fat_g'}
								<td>{grams(targets[c.key])}</td>
							{:else}
								<td></td>
							{/if}
						{/each}
					</tr>
				{/if}
			</tfoot>
		</table>
	</div>
	<p class="small mt-2 text-ink-muted">Averages are over the days with something logged.</p>
</section>
