<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import SummaryCard from '#lib/components/SummaryCard.svelte';
	import MealSection from '#lib/components/MealSection.svelte';
	import EntrySheet from '#lib/components/EntrySheet.svelte';
	import AddSheet from '#lib/components/AddSheet.svelte';
	import Assistant from '#lib/components/Assistant.svelte';
	import Sheet from '#lib/components/Sheet.svelte';
	import { get, post } from '#lib/api.ts';
	import { addDays, dayLabel, longDate } from '#lib/format.ts';
	import { MEALS, MEAL_LABEL, type Day, type Entry, type Meal } from '#lib/types.ts';
	import { session, toasts } from '#lib/state.svelte.ts';

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
	<p class="py-10 text-center text-muted">That's not a date. <a class="underline" href="/day/{today}">Go to today</a></p>
{:else}
	<header class="mb-3 flex items-center gap-1">
		<button class="grid h-11 w-11 place-items-center rounded-full hover:bg-wash" aria-label="Previous day" onclick={() => go(addDays(date, -1))}>
			<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12.5 4.5L7 10l5.5 5.5" /></svg>
		</button>
		<button class="relative min-h-11 min-w-0 flex-1 rounded-xl text-center hover:bg-wash" onclick={openDatePicker} aria-label="Pick a date">
			<span class="block text-[17px] leading-tight font-semibold">{dayLabel(date, today)}</span>
			<span class="block text-[12px] leading-tight text-muted">{longDate(date)}</span>
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
		<button class="grid h-11 w-11 place-items-center rounded-full hover:bg-wash" aria-label="Next day" onclick={() => go(addDays(date, 1))}>
			<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7.5 4.5L13 10l-5.5 5.5" /></svg>
		</button>
		{#if date !== today}
			<button class="btn btn-ghost ml-1 min-h-9 px-3 text-sm" onclick={() => go(today)}>Today</button>
		{/if}
	</header>

	{#if loadError && !day}
		<p class="py-10 text-center text-critical-text">{loadError}</p>
	{:else if day}
		<div class="space-y-3 transition-opacity {day.date !== date ? 'opacity-50' : ''}">
			<SummaryCard totals={day.totals} targets={day.targets} />
			{#each MEALS as meal (meal)}
				<MealSection
					{meal}
					entries={day.meals[meal] ?? []}
					subtotal={day.meal_totals[meal]}
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
			<!-- room for the docked assistant composer -->
			<div class="h-16"></div>
		</div>
	{:else}
		<div class="space-y-3">
			<div class="card h-44 animate-pulse"></div>
			{#each MEALS as m (m)}<div class="card h-20 animate-pulse"></div>{/each}
		</div>
	{/if}

	<Assistant {date} onchanged={refresh} />
	<EntrySheet entry={editing} bind:open={editOpen} onchanged={refresh} />
	<AddSheet bind:open={addOpen} meal={addMeal} {date} onchanged={refresh} />
	<Sheet bind:open={saveOpen} title="Save as quick meal">
		<div class="space-y-3 pt-1">
			<p class="text-[14px] text-ink-2">
				Saves the database foods in {saveMeal ? MEAL_LABEL[saveMeal].toLowerCase() : 'this meal'} so you can log them again in one tap.
			</p>
			<label class="block"><span class="label">Name</span><input class="field" bind:value={saveName} /></label>
		</div>
		{#snippet footer()}
			<button class="btn btn-primary w-full" disabled={!saveName.trim()} onclick={confirmSave}>Save</button>
		{/snippet}
	</Sheet>
{/if}
