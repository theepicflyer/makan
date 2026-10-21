<script lang="ts">
	import EntryRow from './EntryRow.svelte';
	import type { Entry, Meal, Nutrients } from '../types.ts';
	import { MEAL_LABEL } from '../types.ts';
	import { kcal } from '../format.ts';

	let {
		meal,
		entries,
		subtotal,
		onadd,
		onedit,
		onsave
	}: {
		meal: Meal;
		entries: Entry[];
		subtotal: Nutrients;
		onadd: (meal: Meal) => void;
		onedit: (entry: Entry) => void;
		onsave: (meal: Meal) => void;
	} = $props();
</script>

<section class="card px-2 pt-2 pb-1" aria-label={MEAL_LABEL[meal]}>
	<header class="flex items-center gap-2 px-2 pt-1 pb-1">
		<h3 class="text-[15px] font-semibold">{MEAL_LABEL[meal]}</h3>
		{#if entries.length}
			<span class="text-[13px] text-muted tabular">{kcal(subtotal.kcal)} kcal</span>
		{/if}
		<div class="ml-auto flex items-center">
			{#if entries.some((e) => e.food_id != null)}
				<button
					class="grid h-11 w-11 place-items-center rounded-full text-ink-2 hover:bg-wash"
					aria-label="Save {MEAL_LABEL[meal]} as a quick meal"
					title="Save as quick meal"
					onclick={() => onsave(meal)}
				>
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-6-4-6 4z" /></svg>
				</button>
			{/if}
			<button class="btn btn-ghost min-h-9 px-3 text-sm" onclick={() => onadd(meal)} aria-label="Add to {MEAL_LABEL[meal]}">
				<svg width="14" height="14" viewBox="0 0 16 16" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 3v10M3 8h10" /></svg>
				Add
			</button>
		</div>
	</header>
	{#if entries.length}
		<ul>
			{#each entries as entry (entry.id)}
				<li><EntryRow {entry} onclick={() => onedit(entry)} /></li>
			{/each}
		</ul>
	{:else}
		<p class="px-2 pb-2 text-[13px] text-muted">Nothing logged</p>
	{/if}
</section>
