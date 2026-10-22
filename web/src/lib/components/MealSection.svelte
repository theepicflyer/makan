<script lang="ts">
	import EntryRow from './EntryRow.svelte';
	import Icon from '../burrow/Icon.svelte';
	import Trace from '../burrow/Trace.svelte';
	import type { Entry, Meal, Nutrients } from '../types.ts';
	import { MEAL_LABEL } from '../types.ts';
	import { kcal } from '../format.ts';
	import { wide } from '../state.svelte.ts';

	let {
		meal,
		entries,
		subtotal,
		next = false,
		onadd,
		onedit,
		onsave
	}: {
		meal: Meal;
		entries: Entry[];
		subtotal: Nutrients;
		/** The meal the day's trail leads to: the first empty one after the last logged. */
		next?: boolean;
		onadd: (meal: Meal) => void;
		onedit: (entry: Entry) => void;
		onsave: (meal: Meal) => void;
	} = $props();

	const label = $derived(MEAL_LABEL[meal]);
</script>

{#if entries.length}
	<!-- a logged meal: Bao took a bite out of the corner -->
	<div class="bh-nibble">
		<section class="bh-card bh-card--nibbled" aria-label={label}>
			<header class="bh-card__head mk-nibble-head mb-1 justify-start">
				<h2 class="bh-card__title">{label}</h2>
				<span class="small bh-num text-ink-muted">{kcal(subtotal.kcal)} kcal</span>
			</header>
			<ul class="mk-rows">
				{#each entries as entry (entry.id)}
					<li><EntryRow {entry} onclick={() => onedit(entry)} /></li>
				{/each}
			</ul>
			<div class="mk-card-actions">
				{#if entries.some((e) => e.food_id != null)}
					<button class="bh-btn bh-btn--ghost bh-btn--sm" aria-label="Save {label} as a quick meal" onclick={() => onsave(meal)}>
						<Icon name="bookmark" size={18} />Save meal
					</button>
				{/if}
				<button class="bh-btn bh-btn--secondary bh-btn--sm" aria-label="Add to {label}" onclick={() => onadd(meal)}>
					<Icon name="plus" size={18} />Add
				</button>
			</div>
		</section>
		<Trace name="crumbs" size={26} class="bh-nibble__crumbs" />
	</div>
{:else}
	<section class="bh-card {next ? '' : 'mk-card--quiet'}" aria-label={label} data-trail-end={next || undefined}>
		<div class="flex items-center gap-3">
			<div class="min-w-0 flex-1">
				<h2 class="bh-card__title">{label}</h2>
				<p class="small text-ink-muted">{next ? `Up next. Tell Bao${wide.current ? '' : ' below'}, or add food.` : 'Nothing logged'}</p>
			</div>
			<button class="bh-btn {next ? 'bh-btn--secondary' : 'bh-btn--ghost'} bh-btn--sm" aria-label="Add to {label}" onclick={() => onadd(meal)}>
				<Icon name="plus" size={18} />Add
			</button>
		</div>
	</section>
{/if}
