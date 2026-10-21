<script lang="ts">
	import SourceBadge from '#lib/components/SourceBadge.svelte';
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
		<a href="/foods/{food.id}" class="flex min-h-14 items-center gap-3 rounded-xl px-2 py-2 hover:bg-wash">
			<span class="min-w-0 flex-1">
				<span class="block truncate text-[15px] font-medium">{food.name}</span>
				<span class="block truncate text-[13px] text-muted">
					{food.brand ? `${food.brand} · ` : ''}{servingKcal(food)}{food.aliases.length ? ` · “${food.aliases.join('”, “')}”` : ''}
				</span>
			</span>
			<SourceBadge source={food.source} />
		</a>
	</li>
{/snippet}

<header class="mb-3 flex items-center justify-between pt-1">
	<h1 class="text-2xl font-semibold tracking-tight">Foods</h1>
	<a href="/foods/new" class="btn btn-primary min-h-10 text-sm">New food</a>
</header>

<div class="relative mb-4">
	<svg class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
	<input class="field pl-10" type="search" bind:value={query} oninput={onInput} placeholder="Search all foods" aria-label="Search all foods" />
</div>

{#if query.trim()}
	<section class="card px-2 py-1">
		{#if searching && !results.length}
			<p class="px-2 py-4 text-sm text-muted">Searching…</p>
		{:else if !results.length}
			<p class="px-2 py-4 text-sm text-muted">No matches.</p>
		{:else}
			<ul>
				{#each results as food (food.id)}{@render foodRow(food)}{/each}
			</ul>
		{/if}
	</section>
{:else}
	<section>
		<h2 class="mb-2 text-[15px] font-semibold">Ours <span class="font-normal text-muted">· shared by the household</span></h2>
		{#if ours === null}
			<div class="card h-32 animate-pulse"></div>
		{:else if !ours.length}
			<div class="card px-4 py-4 text-[14px] text-ink-2">
				<p>No household foods yet.</p>
				<p class="mt-1 text-muted">Add the things you buy and eat often. Their aliases make them the default, so "a bowl of yogurt" means your yogurt.</p>
			</div>
		{:else}
			<ul class="card px-2 py-1">
				{#each ours as food (food.id)}{@render foodRow(food)}{/each}
			</ul>
		{/if}
		<p class="mt-3 flex gap-2 rounded-2xl bg-wash px-4 py-3 text-[13px] text-ink-2">
			<svg class="mt-0.5 shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l1.5-2h7L17 8h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
			<span>Tip: send a photo of a nutrition label to the assistant on the Today screen and it saves the food here for you.</span>
		</p>
	</section>
{/if}
