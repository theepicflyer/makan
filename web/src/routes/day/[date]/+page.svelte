<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import DaySummary from '#lib/components/DaySummary.svelte';
	import MacrosCard from '#lib/components/MacrosCard.svelte';
	import MealSection from '#lib/components/MealSection.svelte';
	import EntrySheet from '#lib/components/EntrySheet.svelte';
	import AddSheet from '#lib/components/AddSheet.svelte';
	import Assistant from '#lib/components/Assistant.svelte';
	import Sheet from '#lib/components/Sheet.svelte';
	import Field from '#lib/burrow/Field.svelte';
	import Habitat from '#lib/burrow/Habitat.svelte';
	import Icon from '#lib/burrow/Icon.svelte';
	import Loader from '#lib/burrow/Loader.svelte';
	import TrailPath from '#lib/burrow/TrailPath.svelte';
	import type { Mood } from '#lib/burrow/art.js';
	import { get, post } from '#lib/api.ts';
	import { addDays, dayLabel, daySubtitle, dayTitle } from '#lib/format.ts';
	import { MEALS, MEAL_LABEL, type Day, type Entry, type Meal } from '#lib/types.ts';
	import { session, toasts, wide } from '#lib/state.svelte.ts';

	const date = $derived(page.params.date ?? '');
	const today = $derived(session.me?.today ?? date);
	const valid = $derived(/^\d{4}-\d{2}-\d{2}$/.test(date));

	let day = $state<Day | null>(null);
	let loadError = $state<string | null>(null);
	let editing = $state<Entry | null>(null);
	let editOpen = $state(false);
	let addMeal = $state<Meal>('breakfast');
	let addOpen = $state(false);
	let saveMeal = $state<Meal | null>(null);
	let saveOpen = $state(false);
	let saveName = $state('');
	let dateInput: HTMLInputElement | undefined = $state();
	let seq = 0;

	async function load(d: string) {
		const mine = ++seq;
		try {
			const res = await get<Day>(`/api/days/${d}`);
			if (mine === seq) {
				day = res;
				loadError = null;
			}
		} catch (err) {
			if (mine === seq) loadError = (err as Error).message;
		}
	}

	$effect(() => {
		if (valid) load(date);
	});

	function refresh() {
		load(date);
	}

	function go(d: string) {
		goto(`/day/${d}`, { replace: true, reset: false });
	}

	function openDatePicker() {
		if (!dateInput) return;
		if (typeof dateInput.showPicker === 'function') dateInput.showPicker();
		else dateInput.click();
	}

	// Bao's mood follows the day: asleep before anything is logged, glad near the target, worried past it.
	const mood = $derived.by((): Mood => {
		if (!day || day.date !== date || !MEALS.some((m) => day?.meals[m]?.length)) return 'sleepy';
		const eaten = day.totals.kcal ?? 0;
		const target = day.targets.kcal;
		if (target && eaten > target) return 'worried';
		if (target && eaten >= target * 0.9) return 'joy';
		return 'happy';
	});

	// Today's trail leads to the first empty meal after the last one logged.
	const next = $derived.by((): Meal | null => {
		if (!day || date !== today) return null;
		const last = MEALS.findLastIndex((m) => day?.meals[m]?.length);
		return MEALS.find((m, i) => i > last && !day?.meals[m]?.length) ?? null;
	});

	function startSave(meal: Meal) {
		saveMeal = meal;
		saveName = `Usual ${MEAL_LABEL[meal].toLowerCase()}`;
		saveOpen = true;
	}

	async function confirmSave() {
		if (!day || !saveMeal) return;
		const ids = day.meals[saveMeal].filter((e) => e.food_id != null).map((e) => e.id);
		try {
			await post('/api/saved-meals', { name: saveName.trim(), entry_ids: ids });
			toasts.show(`Saved "${saveName.trim()}" to quick add`);
			saveOpen = false;
		} catch (err) {
			toasts.error((err as Error).message);
		}
	}
</script>

<svelte:head><title>{valid ? `${dayLabel(date, today)} · makan` : 'makan'}</title></svelte:head>

{#if !valid}
	<div class="mk-page py-10 text-center text-ink-muted">That's not a date. <a class="mk-link" href="/day/{today}">Go to today</a></div>
{:else}
	<Habitat kind="meadow" {mood} class="mk-top">
		<p class="small text-ink-muted">{daySubtitle(date, today)}</p>
		<h1 class="page-title">{dayTitle(date, today)}</h1>
		<div class="mt-2 flex items-center gap-1.5">
			<button class="bh-btn bh-btn--secondary bh-btn--sm bh-btn--icon" aria-label="Previous day" onclick={() => go(addDays(date, -1))}>
				<Icon name="chevron-left" size={18} />
			</button>
			<button class="bh-btn bh-btn--secondary bh-btn--sm bh-btn--icon relative" onclick={openDatePicker} aria-label="Pick a date">
				<Icon name="calendar" size={18} />
				<input
					bind:this={dateInput}
					type="date"
					class="pointer-events-none absolute inset-0 opacity-0"
					tabindex="-1"
					aria-hidden="true"
					value={date}
					onchange={(e) => {
						const v = (e.currentTarget as HTMLInputElement).value;
						if (v) go(v);
					}}
				/>
			</button>
			<button class="bh-btn bh-btn--secondary bh-btn--sm bh-btn--icon" aria-label="Next day" onclick={() => go(addDays(date, 1))}>
				<Icon name="chevron-right" size={18} />
			</button>
			{#if date !== today}
				<button class="bh-btn bh-btn--ghost bh-btn--sm" onclick={() => go(today)}>Today</button>
			{/if}
		</div>
	</Habitat>

	{#snippet meals(d: Day)}
		{#each MEALS as meal (meal)}
			<MealSection
				{meal}
				entries={d.meals[meal] ?? []}
				subtotal={d.meal_totals[meal]}
				next={meal === next}
				onadd={(m) => {
					addMeal = m;
					addOpen = true;
				}}
				onedit={(e) => {
					editing = e;
					editOpen = true;
				}}
				onsave={startSave}
			/>
		{/each}
	{/snippet}

	{#snippet macros(d: Day)}
		<MacrosCard protein={d.totals.protein_g ?? 0} carbs={d.totals.carb_g ?? 0} fat={d.totals.fat_g ?? 0} targets={d.targets} />
	{/snippet}

	<div class="mk-page">
		{#if loadError && !day}
			<p class="py-10 text-center font-semibold text-tomato-text">Couldn't load this day: {loadError}</p>
		{:else if day && wide.current}
			<!-- desktop: the day at a glance and Bao on the left, the meals on the right -->
			<div class="grid grid-cols-[minmax(0,19rem)_minmax(0,1fr)] items-start gap-8 pt-6 pb-6 xl:grid-cols-[minmax(0,23rem)_minmax(0,1fr)] xl:gap-10 transition-opacity {day.date !== date ? 'opacity-50' : ''}">
				<div class="grid gap-8 [@media(min-height:780px)]:sticky [@media(min-height:780px)]:top-6">
					<DaySummary totals={day.totals} targets={day.targets} />
					{@render macros(day)}
					<Assistant {date} onchanged={refresh} inline />
				</div>
				<!-- Bao's crumbs wind down behind the meals, strongest up to the next one -->
				<TrailPath kind="crumbs" from={0.5} to={0.3} seed={1} class="grid gap-9">
					{@render meals(day)}
				</TrailPath>
			</div>
		{:else if day}
			<div class="transition-opacity {day.date !== date ? 'opacity-50' : ''}">
				<DaySummary totals={day.totals} targets={day.targets} />
				<!-- Bao's crumbs wind down from the sunflower behind the cards, strongest up to the next meal -->
				<TrailPath kind="crumbs" from={0.5} to={0.3} seed={1} class="grid gap-9 pt-9">
					{@render macros(day)}
					{@render meals(day)}
				</TrailPath>
				<!-- room for the docked composer and Bao over it -->
				<div class="h-16"></div>
			</div>
		{:else}
			<div class="grid justify-items-center py-16"><Loader kind="crumbs" label="Fetching your day…" /></div>
		{/if}
	</div>

	{#if !wide.current}
		<Assistant {date} onchanged={refresh} />
	{/if}
	<EntrySheet entry={editing} bind:open={editOpen} onchanged={refresh} />
	<AddSheet bind:open={addOpen} meal={addMeal} {date} onchanged={refresh} />
	<Sheet bind:open={saveOpen} title="Save as quick meal">
		<div class="space-y-4 pt-1">
			<p class="body text-ink-muted">
				Saves the database foods in {saveMeal ? MEAL_LABEL[saveMeal].toLowerCase() : 'this meal'} so you can log them again in one tap.
			</p>
			<Field label="Name" bind:value={saveName} />
		</div>
		{#snippet footer()}
			<button class="bh-btn bh-btn--primary w-full" disabled={!saveName.trim()} onclick={confirmSave}>Save meal</button>
		{/snippet}
	</Sheet>
{/if}
