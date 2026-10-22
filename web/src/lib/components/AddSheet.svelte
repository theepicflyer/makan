<script lang="ts">
	import Sheet from './Sheet.svelte';
	import NutrientIcon from './NutrientIcon.svelte';
	import PortionPicker from './PortionPicker.svelte';
	import SourceBadge from './SourceBadge.svelte';
	import EmptyState from '../burrow/EmptyState.svelte';
	import Icon from '../burrow/Icon.svelte';
	import Loader from '../burrow/Loader.svelte';
	import Trace from '../burrow/Trace.svelte';
	import { MEAL_LABEL, MEAL_TRACE, type Entry, type Food, type Meal, type Portion, type Quick, type QuickItem, type SavedMeal } from '../types.ts';
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

	const total = (entries: Entry[]) => entries.reduce((sum, e) => sum + (e.kcal ?? 0), 0);

	async function run(fn: () => Promise<Entry[]>, label: (entries: Entry[]) => string) {
		if (busy) return;
		busy = true;
		try {
			const entries = await fn();
			undoable(entries, label(entries));
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
		}, (entries) => `${MEAL_LABEL[meal]}: ${food.name} logged, ${kcal(entries[0]?.kcal)} kcal`);
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
		}, () => `${MEAL_LABEL[meal]}: ${item.name} logged, ${kcal(item.kcal)} kcal`);
	}

	function addSaved(m: SavedMeal) {
		run(async () => {
			const res = await post<{ entries: Entry[] }>(`/api/saved-meals/${m.id}/log`, { date, meal });
			return res.entries;
		}, (entries) => `${MEAL_LABEL[meal]}: ${m.name} logged, ${kcal(total(entries))} kcal`);
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
		}, (entries) => `${MEAL_LABEL[meal]} logged: same as yesterday, ${kcal(total(entries))} kcal`);
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
		<button class="bh-row mk-row-btn min-w-0 flex-1" onclick={() => addQuick(item)} disabled={busy}>
			<span class="bh-row__tile"><Trace name={MEAL_TRACE[meal]} size={30} /></span>
			<span class="bh-row__text">
				<span class="bh-row__title">{item.name}</span>
				<span class="bh-row__sub truncate">{portionText(item.servings, item.serving_label, item.grams)}</span>
			</span>
			<span class="bh-row__amount"><NutrientIcon kind="energy" labelled />{kcal(item.kcal)}</span>
		</button>
		{#if remove}
			<button class="bh-btn bh-btn--ghost bh-btn--sm bh-btn--icon ml-1 shrink-0 text-ink-muted" aria-label="Remove {item.name}" onclick={remove}>
				<Icon name="close" size={16} />
			</button>
		{/if}
	</li>
{/snippet}

<Sheet bind:open title={picked ? picked.name : `Add to ${MEAL_LABEL[meal].toLowerCase()}`} tall>
	{#if picked}
		<div class="space-y-4 pt-1">
			<button class="bh-btn bh-btn--ghost bh-btn--sm -ml-3" onclick={() => (picked = null)}>
				<Icon name="chevron-left" size={18} />Back to results
			</button>
			<div class="small flex items-center gap-2 text-ink-muted">
				<SourceBadge source={picked.source} />
				<span class="truncate">{picked.brand ?? picked.category ?? ''}</span>
			</div>
			{#if picked.description}
				<p class="small text-ink-muted">{picked.description}</p>
			{/if}
			<PortionPicker food={picked} bind:value={portion} />
		</div>
	{:else}
		<div class="sticky top-0 z-10 -mx-5 bg-surface px-5 pb-3">
			<label class="bh-field">
				<span class="sr-only">Search foods</span>
				<span class="bh-field__box">
					<span class="bh-field__affix"><Icon name="search" size={20} /></span>
					<input
						bind:this={input}
						bind:value={query}
						oninput={onInput}
						class="bh-field__input"
						type="search"
						placeholder="e.g. chicken rice"
						autocomplete="off"
					/>
				</span>
			</label>
		</div>

		{#if query.trim()}
			{#if searching && !results.length}
				<div class="grid justify-items-center py-8"><Loader label="Digging through the foods…" /></div>
			{:else if !results.length}
				<EmptyState character="gali" mood="worried" size={88} title="No matches" body="Try a shorter word, or describe it to Bao instead." />
			{:else}
				<ul class="mk-rows">
					{#each results as food (food.id)}
						<li>
							<button class="bh-row mk-row-btn" onclick={() => choose(food)}>
								<span class="bh-row__text">
									<span class="bh-row__title">{food.name}</span>
									<span class="bh-row__sub truncate">{food.brand ? `${food.brand} · ` : ''}<NutrientIcon kind="energy" />{servingKcal(food)}</span>
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
						<h3 class="mk-section-label">Same as yesterday</h3>
						<button class="bh-row mk-row-btn" onclick={addYesterday} disabled={busy}>
							<span class="bh-row__tile"><Trace name={MEAL_TRACE[meal]} size={30} /></span>
							<span class="bh-row__text">
								<span class="bh-row__title">Yesterday's {MEAL_LABEL[meal].toLowerCase()}</span>
								<span class="bh-row__sub truncate">{quick.yesterday.items.map((i) => i.name).join(', ')}</span>
							</span>
							<span class="bh-row__amount"><NutrientIcon kind="energy" labelled />{kcal(quick.yesterday.kcal)}</span>
						</button>
					</section>
				{/if}
				{#if quick.pins.length}
					<section>
						<h3 class="mk-section-label">Pinned</h3>
						<ul class="mk-rows">
							{#each quick.pins as item (item.id)}
								{@render quickRow(item, () => unpin(item))}
							{/each}
						</ul>
					</section>
				{/if}
				{#if quick.saved_meals.length}
					<section>
						<h3 class="mk-section-label">Saved meals</h3>
						<ul class="mk-rows">
							{#each quick.saved_meals as m (m.id)}
								<li class="flex items-center">
									<button class="bh-row mk-row-btn min-w-0 flex-1" onclick={() => addSaved(m)} disabled={busy}>
										<span class="bh-row__tile"><Icon name="bookmark" size={22} /></span>
										<span class="bh-row__text">
											<span class="bh-row__title">{m.name}</span>
											<span class="bh-row__sub truncate">{m.items.map((i) => i.name ?? 'item').join(', ')}</span>
										</span>
									</button>
									<button
										class="bh-btn bh-btn--ghost bh-btn--sm bh-btn--icon ml-1 shrink-0 text-ink-muted"
										aria-label="Delete saved meal {m.name}"
										onclick={() => removeSaved(m)}
									>
										<Icon name="close" size={16} />
									</button>
								</li>
							{/each}
						</ul>
					</section>
				{/if}
				{#if quick.frequent.length}
					<section>
						<h3 class="mk-section-label">Frequent</h3>
						<ul class="mk-rows">
							{#each quick.frequent as item (`f${item.food_id}`)}
								{@render quickRow(item)}
							{/each}
						</ul>
					</section>
				{/if}
				{#if quick.recent.length}
					<section>
						<h3 class="mk-section-label">Recent</h3>
						<ul class="mk-rows">
							{#each quick.recent as item (`r${item.food_id}`)}
								{@render quickRow(item)}
							{/each}
						</ul>
					</section>
				{/if}
				{#if !quick.pins.length && !quick.frequent.length && !quick.recent.length && !quick.saved_meals.length && !quick.yesterday}
					<EmptyState title="Nothing to pick from yet" body="Search above. Foods you log show up here for one-tap adds." />
				{/if}
			</div>
		{/if}
	{/if}

	{#snippet footer()}
		{#if picked}
			<button class="bh-btn bh-btn--primary w-full" onclick={addPicked} disabled={busy}>Add to {MEAL_LABEL[meal].toLowerCase()}</button>
		{:else}
			<button class="bh-btn bh-btn--secondary w-full" onclick={() => (open = false)}>Done</button>
		{/if}
	{/snippet}
</Sheet>
