<script lang="ts">
	import Sheet from './Sheet.svelte';
	import PortionPicker from './PortionPicker.svelte';
	import SourceBadge from './SourceBadge.svelte';
	import Field from '../burrow/Field.svelte';
	import Icon from '../burrow/Icon.svelte';
	import { MEALS, MEAL_LABEL, type Entry, type Food, type Meal, type Portion } from '../types.ts';
	import { del, get, patch, post } from '../api.ts';
	import { initialPortion, portionPayload } from '../format.ts';
	import { toasts } from '../state.svelte.ts';

	let {
		entry,
		open = $bindable(false),
		onchanged
	}: { entry: Entry | null; open?: boolean; onchanged: () => void } = $props();

	let food = $state<Food | null>(null);
	let portion = $state<Portion>({ unit: 'g', count: 1, grams: 100 });
	let startPortion = '';
	let meal = $state<Meal>('breakfast');
	let date = $state('');
	let note = $state('');
	let name = $state('');
	let est = $state({ kcal: 0, protein_g: 0, carb_g: 0, fat_g: 0 });
	let busy = $state(false);
	let loadedFor = -1;

	$effect(() => {
		if (!open || !entry || loadedFor === entry.id) return;
		const e = entry;
		loadedFor = e.id;
		meal = e.meal;
		date = e.date;
		note = e.note ?? '';
		name = e.name;
		est = { kcal: e.kcal ?? 0, protein_g: e.protein_g ?? 0, carb_g: e.carb_g ?? 0, fat_g: e.fat_g ?? 0 };
		food = null;
		if (e.food_id != null) {
			get<Food>(`/api/foods/${e.food_id}`)
				.then((f) => {
					food = f;
					portion = initialPortion(f, e.servings, e.serving_label, e.grams);
					startPortion = JSON.stringify(portion);
				})
				.catch((err) => toasts.error(err.message));
		}
	});

	$effect(() => {
		if (!open) loadedFor = -1;
	});

	async function save() {
		if (!entry) return;
		const body: Record<string, unknown> = {};
		if (meal !== entry.meal) body.meal = meal;
		if (date && date !== entry.date) body.date = date;
		if ((note || null) !== (entry.note || null)) body.note = note;
		if (food) {
			if (JSON.stringify(portion) !== startPortion) Object.assign(body, portionPayload(portion));
		} else {
			if (name.trim() && name.trim() !== entry.name) body.name = name.trim();
			const changed =
				est.kcal !== (entry.kcal ?? 0) ||
				est.protein_g !== (entry.protein_g ?? 0) ||
				est.carb_g !== (entry.carb_g ?? 0) ||
				est.fat_g !== (entry.fat_g ?? 0);
			if (changed) body.nutrients = { ...est };
		}
		if (!Object.keys(body).length) {
			open = false;
			return;
		}
		busy = true;
		try {
			await patch(`/api/entries/${entry.id}`, body);
			open = false;
			onchanged();
		} catch (err) {
			toasts.error((err as Error).message);
		} finally {
			busy = false;
		}
	}

	async function remove() {
		if (!entry) return;
		const e = entry;
		busy = true;
		try {
			await del(`/api/entries/${e.id}`);
			open = false;
			onchanged();
			toasts.show(`Removed ${e.name} from ${MEAL_LABEL[e.meal].toLowerCase()}`, {
				action: {
					label: 'Undo',
					run: async () => {
						await post('/api/entries', {
							date: e.date,
							meal: e.meal,
							food_id: e.food_id,
							servings: e.servings,
							serving: e.serving_label,
							grams: e.serving_label ? null : e.grams,
							name: e.food_id ? null : e.name,
							nutrients: e.food_id
								? null
								: { kcal: e.kcal, protein_g: e.protein_g, carb_g: e.carb_g, fat_g: e.fat_g },
							note: e.note
						});
						onchanged();
					}
				}
			});
		} catch (err) {
			toasts.error((err as Error).message);
		} finally {
			busy = false;
		}
	}

	async function pin() {
		if (!food) return;
		try {
			await post('/api/pins', { food_id: food.id, ...pinPortion() });
			toasts.show(`Pinned ${food.name} to quick add`);
		} catch (err) {
			toasts.error((err as Error).message);
		}
	}

	function pinPortion() {
		const p = portionPayload(portion);
		return p.grams != null ? { grams: p.grams } : { servings: p.servings, serving_label: p.serving };
	}
</script>

<Sheet bind:open title={entry?.name ?? 'Entry'}>
	{#if entry}
		<div class="space-y-5 pt-1">
			{#if entry.photo_id}
				<img src="/api/photos/{entry.photo_id}" alt="Meal" class="max-h-56 w-full rounded-[var(--radius-md)] border-2 border-outline object-cover" />
			{/if}

			{#if entry.food_id != null}
				{#if food}
					<div class="small flex items-center gap-2 text-ink-muted">
						<SourceBadge source={food.source} />
						<span class="truncate">{food.brand ? `${food.brand} · ` : ''}{food.name}</span>
					</div>
					<PortionPicker {food} bind:value={portion} />
				{:else}
					<div class="mk-well h-32 motion-safe:animate-pulse"></div>
				{/if}
			{:else}
				<div class="space-y-3">
					<Field label="Name" bind:value={name} />
					<div class="grid grid-cols-2 gap-3">
						<Field label="Calories" nutrient="energy" suffix="kcal" type="number" inputmode="decimal" bind:value={est.kcal} />
						<Field label="Protein" nutrient="protein" suffix="g" type="number" inputmode="decimal" bind:value={est.protein_g} />
						<Field label="Carbs" nutrient="carbs" suffix="g" type="number" inputmode="decimal" bind:value={est.carb_g} />
						<Field label="Fat" nutrient="fat" suffix="g" type="number" inputmode="decimal" bind:value={est.fat_g} />
					</div>
					<p class="small text-ink-muted">Estimated item, not linked to a database food.</p>
				</div>
			{/if}

			<div>
				<span class="mk-section-label">Meal</span>
				<div class="mk-choice" role="radiogroup" aria-label="Meal">
					{#each MEALS as m (m)}
						<button role="radio" aria-checked={meal === m} class="bh-chip {meal === m ? 'is-selected' : ''}" onclick={() => (meal = m)}>
							{#if meal === m}<Icon name="check" size={16} />{/if}{MEAL_LABEL[m]}
						</button>
					{/each}
				</div>
			</div>

			<Field label="Date" type="date" bind:value={date} />
			<Field label="Note" bind:value={note} placeholder="e.g. less rice, no skin" />
		</div>
	{/if}
	{#snippet footer()}
		<div class="flex items-center gap-1">
			<button class="bh-btn bh-btn--ghost mk-danger -ml-3" onclick={remove} disabled={busy}><Icon name="trash" size={18} />Delete</button>
			{#if food}
				<button class="bh-btn bh-btn--ghost" onclick={pin} disabled={busy}><Icon name="pin" size={18} />Pin</button>
			{/if}
			<button class="bh-btn bh-btn--primary ml-auto min-w-28" onclick={save} disabled={busy}>Save</button>
		</div>
	{/snippet}
</Sheet>
