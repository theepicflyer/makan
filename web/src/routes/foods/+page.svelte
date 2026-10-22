<script lang="ts">
	import SourceBadge from '#lib/components/SourceBadge.svelte';
	import EmptyState from '#lib/burrow/EmptyState.svelte';
	import Habitat from '#lib/burrow/Habitat.svelte';
	import Icon from '#lib/burrow/Icon.svelte';
	import Loader from '#lib/burrow/Loader.svelte';
	import TrailGap from '#lib/burrow/TrailGap.svelte';
	import { get } from '#lib/api.ts';
	import { servingKcal } from '#lib/format.ts';
	import type { Food } from '#lib/types.ts';
	import { toasts } from '#lib/state.svelte.ts';
	import { onMount } from 'svelte';

	let ours = $state<Food[] | null>(null);
	let query = $state('');
	let results = $state<Food[]>([]);
	let searching = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let seq = 0;

	onMount(async () => {
		try {
			ours = (await get<{ foods: Food[] }>('/api/foods/ours')).foods;
		} catch (err) {
			toasts.error((err as Error).message);
			ours = [];
		}
	});

	function onInput() {
		clearTimeout(timer);
		const q = query.trim();
		if (!q) {
			results = [];
			return;
		}
		searching = true;
		timer = setTimeout(async () => {
			const mine = ++seq;
			try {
				const res = await get<{ results: Food[] }>(`/api/foods/search?q=${encodeURIComponent(q)}&limit=40`);
				if (mine === seq) results = res.results;
			} finally {
				if (mine === seq) searching = false;
			}
		}, 220);
	}
</script>

<svelte:head><title>Foods · makan</title></svelte:head>

{#snippet foodRow(food: Food)}
	<li>
		<a href="/foods/{food.id}" class="bh-row mk-row-btn">
			<span class="bh-row__text">
				<span class="bh-row__title">{food.name}</span>
				<span class="bh-row__sub truncate">
					{food.brand ? `${food.brand} · ` : ''}{servingKcal(food)}{food.aliases.length ? ` · “${food.aliases.join('”, “')}”` : ''}
				</span>
			</span>
			<SourceBadge source={food.source} />
		</a>
	</li>
{/snippet}

<!-- Bao's pantry: the household's own foods, and every reference food to search -->
<Habitat kind="meadow" class="mk-top">
	<p class="small text-ink-muted">Ours, SG FoodID and USDA</p>
	<h1 class="page-title">Foods</h1>
	<a href="/foods/new" class="bh-btn bh-btn--primary bh-btn--sm mt-2"><Icon name="plus" size={18} />New food</a>
</Habitat>

<div class="mk-page pt-4">
	<label class="bh-field">
		<span class="sr-only">Search all foods</span>
		<span class="bh-field__box">
			<span class="bh-field__affix"><Icon name="search" size={20} /></span>
			<input class="bh-field__input" type="search" bind:value={query} oninput={onInput} placeholder="Search all foods" />
		</span>
	</label>

	<TrailGap kind="crumbs" from={0.5} to={0.14} height={36} />

	{#if query.trim()}
		<section class="bh-card py-1" aria-label="Search results">
			{#if searching && !results.length}
				<div class="grid justify-items-center py-6"><Loader label="Digging through the foods…" /></div>
			{:else if !results.length}
				<EmptyState trace="hole" title="No matches" body="Gali dug everywhere. Try a shorter word." />
			{:else}
				<ul class="mk-rows">
					{#each results as food (food.id)}{@render foodRow(food)}{/each}
				</ul>
			{/if}
		</section>
	{:else}
		<section class="bh-card" aria-labelledby="ours-title">
			<header class="bh-card__head mb-1">
				<h2 id="ours-title" class="bh-card__title">Ours</h2>
				<span class="small text-ink-muted">shared by the household</span>
			</header>
			{#if ours === null}
				<div class="grid justify-items-center py-6"><Loader kind="crumbs" /></div>
			{:else if !ours.length}
				<EmptyState
					trace="sunflower"
					title="No household foods yet"
					body="Add the things you buy and eat often. Their aliases make them the default, so “a bowl of yogurt” means your yogurt."
				/>
			{:else}
				<ul class="mk-rows">
					{#each ours as food (food.id)}{@render foodRow(food)}{/each}
				</ul>
			{/if}
		</section>
		<div class="bh-card bh-card--tint body mt-3 flex gap-3">
			<span class="shrink-0 pt-0.5"><Icon name="camera" size={22} /></span>
			<span>Send a photo of a nutrition label to Bao on the Today screen and it saves the food here for you.</span>
		</div>
	{/if}
</div>
