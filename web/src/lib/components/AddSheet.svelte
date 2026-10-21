<script lang="ts">
	import Sheet from './Sheet.svelte';
	import PortionPicker from './PortionPicker.svelte';
	import SourceBadge from './SourceBadge.svelte';
	import { MEAL_LABEL, type Entry, type Food, type Meal, type Portion, type Quick, type QuickItem, type SavedMeal } from '../types.ts';
	import { del, get, post } from '../api.ts';
	import { initialPortion, kcal, portionPayload, portionText, servingKcal } from '../format.ts';
	import { toasts } from '../state.svelte.ts';

	let {
		open = $bindable(false),
		meal,
		date,
		onchanged
	}: { open?: boolean; meal: Meal; date: string; onchanged: () => void } = $props();

	let query = $state('');
	let results = $state<Food[]>([]);
	let searching = $state(false);
	let quick = $state<Quick | null>(null);
	let picked = $state<Food | null>(null);
	let portion = $state<Portion>({ unit: 'g', count: 1, grams: 100 });
	let busy = $state(false);
	let input: HTMLInputElement | undefined = $state();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let seq = 0;

	$effect(() => {
		if (open) {
			query = '';
			results = [];
			picked = null;
			loadQuick();
		}
	});

	async function loadQuick() {
		try {
			quick = await get<Quick>(`/api/quick?meal=${meal}&day=${date}`);
		} catch (err) {
			toasts.error((err as Error).message);
		}
	}

	function onInput() {
		clearTimeout(timer);
		const q = query.trim();
		if (!q) {
			results = [];
			searching = false;
			return;
		}
		searching = true;
		timer = setTimeout(async () => {
			const mine = ++seq;
			try {
				const res = await get<{ results: Food[] }>(`/api/foods/search?q=${encodeURIComponent(q)}&limit=25`);
				if (mine === seq) results = res.results;
			} catch (err) {
				toasts.error((err as Error).message);
			} finally {
				if (mine === seq) searching = false;
			}
		}, 220);
	}

	function choose(food: Food) {
		picked = food;
		portion = initialPortion(food);
	}

	function undoable(entries: Entry[], label: string) {
		onchanged();
		toasts.show(label, {
			action: {
				label: 'Undo',
				run: async () => {
					await Promise.all(entries.map((e) => del(`/api/entries/${e.id}`)));
					onchanged();
				}
			}
		});
	}

	async function run(fn: () => Promise<Entry[]>, label: string) {
		if (busy) return;
		busy = true;
		try {
			const entries = await fn();
			undoable(entries, label);
		} catch (err) {
			toasts.error((err as Error).message);
		} finally {
			busy = false;
		}
	}

	function addPicked() {
		const food = picked;
		if (!food) return;
		run(async () => {
			const entry = await post<Entry>('/api/entries', { date, meal, food_id: food.id, ...portionPayload(portion) });
			picked = null;
			query = '';
			results = [];
			loadQuick();
			return [entry];
		}, `Added ${food.name} to ${MEAL_LABEL[meal].toLowerCase()}`);
	}

	function addQuick(item: QuickItem) {
		run(async () => {
			const entry = await post<Entry>('/api/entries', {
				date,
				meal,
				food_id: item.food_id,
				servings: item.servings,
				serving: item.serving_label,
				grams: item.serving_label ? null : item.grams,
				origin: 'quick'
			});
			return [entry];
		}, `Added ${item.name}`);
	}

	function addSaved(m: SavedMeal) {
		run(async () => {
			const res = await post<{ entries: Entry[] }>(`/api/saved-meals/${m.id}/log`, { date, meal });
			return res.entries;
		}, `Added ${m.name}`);
	}

	function addYesterday() {
		const y = quick?.yesterday;
		if (!y) return;
		run(async () => {
			const res = await post<{ entries: Entry[] }>('/api/entries/copy', {
				entry_ids: y.items.map((i) => i.entry_id),
				date,
				meal
			});
			return res.entries;
		}, `Copied yesterday's ${MEAL_LABEL[meal].toLowerCase()}`);
	}

	async function unpin(item: QuickItem) {
		if (item.id == null || !quick) return;
		await del(`/api/pins/${item.id}`);
		quick = { ...quick, pins: quick.pins.filter((p) => p.id !== item.id) };
	}

	async function removeSaved(m: SavedMeal) {
		if (!quick) return;
		await del(`/api/saved-meals/${m.id}`);
		quick = { ...quick, saved_meals: quick.saved_meals.filter((s) => s.id !== m.id) };
	}
</script>

{#snippet quickRow(item: QuickItem, remove?: () => void)}
	<li class="flex items-center">
		<button class="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-wash" onclick={() => addQuick(item)} disabled={busy}>
			<span class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-wash text-ink-2" aria-hidden="true">
				<svg width="12" height="12" viewBox="0 0 16 16" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M8 3v10M3 8h10" /></svg>
			</span>
			<span class="min-w-0 flex-1">
				<span class="block truncate text-[15px]">{item.name}</span>
				<span class="block truncate text-[13px] text-muted">{portionText(item.servings, item.serving_label, item.grams)}</span>
			</span>
			<span class="shrink-0 text-[14px] font-medium tabular">{kcal(item.kcal)}</span>
		</button>
		{#if remove}
			<button class="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted hover:bg-wash" aria-label="Remove {item.name}" onclick={remove}>
				<svg width="14" height="14" viewBox="0 0 16 16" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
			</button>
		{/if}
	</li>
{/snippet}

<Sheet bind:open title={picked ? picked.name : `Add to ${MEAL_LABEL[meal]}`} tall>
	{#if picked}
		<div class="space-y-4 pt-1">
			<button class="-ml-1 flex min-h-10 items-center gap-1 text-sm text-ink-2" onclick={() => (picked = null)}>
				<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 3L5 8l5 5" /></svg>
				Back to results
			</button>
			<div class="flex items-center gap-2 text-[13px] text-ink-2">
				<SourceBadge source={picked.source} />
				<span class="truncate">{picked.brand ?? picked.category ?? ''}</span>
			</div>
			{#if picked.description}
				<p class="text-[13px] text-muted">{picked.description}</p>
			{/if}
			<PortionPicker food={picked} bind:value={portion} />
		</div>
	{:else}
		<div class="sticky top-0 z-10 -mx-5 bg-surface-2 px-5 pb-3">
			<div class="relative">
				<svg class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
				<input
					bind:this={input}
					bind:value={query}
					oninput={onInput}
					class="field pl-10"
					type="search"
					placeholder="Search foods, e.g. chicken rice"
					autocomplete="off"
					aria-label="Search foods"
				/>
			</div>
		</div>

		{#if query.trim()}
			{#if searching && !results.length}
				<p class="py-6 text-center text-sm text-muted">Searching…</p>
			{:else if !results.length}
				<p class="py-6 text-center text-sm text-muted">No matches. Try a shorter name, or describe it to the assistant.</p>
			{:else}
				<ul class="-mx-2">
					{#each results as food (food.id)}
						<li>
							<button class="flex min-h-12 w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-wash" onclick={() => choose(food)}>
								<span class="min-w-0 flex-1">
									<span class="flex items-center gap-1.5">
										<span class="truncate text-[15px]">{food.name}</span>
									</span>
									<span class="block truncate text-[13px] text-muted">{food.brand ? `${food.brand} · ` : ''}{servingKcal(food)}</span>
								</span>
								<SourceBadge source={food.source} />
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		{:else if quick}
			<div class="space-y-5">
				{#if quick.yesterday}
					<section>
						<h4 class="label">Same as yesterday</h4>
						<button class="card flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-wash" onclick={addYesterday} disabled={busy}>
							<span class="min-w-0 flex-1">
								<span class="block text-[15px] font-medium">Yesterday's {MEAL_LABEL[meal].toLowerCase()}</span>
								<span class="block truncate text-[13px] text-muted">{quick.yesterday.items.map((i) => i.name).join(', ')}</span>
							</span>
							<span class="shrink-0 text-[14px] font-medium tabular">{kcal(quick.yesterday.kcal)}</span>
						</button>
					</section>
				{/if}
				{#if quick.pins.length}
					<section>
						<h4 class="label">Pinned</h4>
						<ul class="-mx-2">
							{#each quick.pins as item (item.id)}
								{@render quickRow(item, () => unpin(item))}
							{/each}
						</ul>
					</section>
				{/if}
				{#if quick.saved_meals.length}
					<section>
						<h4 class="label">Saved meals</h4>
						<ul class="-mx-2">
							{#each quick.saved_meals as m (m.id)}
								<li class="flex items-center">
									<button class="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-wash" onclick={() => addSaved(m)} disabled={busy}>
										<span class="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-wash text-ink-2" aria-hidden="true">
											<svg width="12" height="12" viewBox="0 0 16 16" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M8 3v10M3 8h10" /></svg>
										</span>
										<span class="min-w-0 flex-1">
											<span class="block truncate text-[15px]">{m.name}</span>
											<span class="block truncate text-[13px] text-muted">{m.items.map((i) => i.name ?? 'item').join(', ')}</span>
										</span>
									</button>
									<button class="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted hover:bg-wash" aria-label="Delete saved meal {m.name}" onclick={() => removeSaved(m)}>
										<svg width="14" height="14" viewBox="0 0 16 16" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
									</button>
								</li>
							{/each}
						</ul>
					</section>
				{/if}
				{#if quick.frequent.length}
					<section>
						<h4 class="label">Frequent</h4>
						<ul class="-mx-2">
							{#each quick.frequent as item (`f${item.food_id}`)}
								{@render quickRow(item)}
							{/each}
						</ul>
					</section>
				{/if}
				{#if quick.recent.length}
					<section>
						<h4 class="label">Recent</h4>
						<ul class="-mx-2">
							{#each quick.recent as item (`r${item.food_id}`)}
								{@render quickRow(item)}
							{/each}
						</ul>
					</section>
				{/if}
				{#if !quick.pins.length && !quick.frequent.length && !quick.recent.length && !quick.saved_meals.length && !quick.yesterday}
					<p class="py-6 text-center text-sm text-muted">Search above. Foods you log show up here for one-tap adds.</p>
				{/if}
			</div>
		{/if}
	{/if}

	{#snippet footer()}
		{#if picked}
			<button class="btn btn-primary w-full" onclick={addPicked} disabled={busy}>Add to {MEAL_LABEL[meal].toLowerCase()}</button>
		{:else}
			<button class="btn btn-ghost w-full" onclick={() => (open = false)}>Done</button>
		{/if}
	{/snippet}
</Sheet>
