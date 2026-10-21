<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import FoodForm from '#lib/components/FoodForm.svelte';
	import SourceBadge from '#lib/components/SourceBadge.svelte';
	import PortionPicker from '#lib/components/PortionPicker.svelte';
	import { del, get, patch, post } from '#lib/api.ts';
	import { draftFrom, draftPayload, emptyDraft } from '#lib/fooddraft.ts';
	import { initialPortion, portionPayload } from '#lib/format.ts';
	import type { Food, FoodDraft, NutrientKey, Portion } from '#lib/types.ts';
	import { toasts } from '#lib/state.svelte.ts';

	const id = $derived(page.params.id ?? '');
	const isNew = $derived(id === 'new');

	let food = $state<Food | null>(null);
	let draft = $state<FoodDraft>(emptyDraft());
	let portion = $state<Portion>({ unit: 'g', count: 1, grams: 100 });
	let busy = $state(false);
	let error = $state<string | null>(null);

	$effect(() => {
		const current = id;
		if (current === 'new') {
			food = null;
			draft = emptyDraft();
			return;
		}
		get<Food>(`/api/foods/${current}`)
			.then((f) => {
				food = f;
				draft = draftFrom(f);
				portion = initialPortion(f);
			})
			.catch((err) => (error = (err as Error).message));
	});

	const ROWS: { key: NutrientKey; label: string; unit: string }[] = [
		{ key: 'kcal', label: 'Calories', unit: 'kcal' },
		{ key: 'protein_g', label: 'Protein', unit: 'g' },
		{ key: 'carb_g', label: 'Carbohydrate', unit: 'g' },
		{ key: 'fat_g', label: 'Fat', unit: 'g' },
		{ key: 'sat_fat_g', label: 'Saturated fat', unit: 'g' },
		{ key: 'fibre_g', label: 'Dietary fibre', unit: 'g' },
		{ key: 'sugar_g', label: 'Sugar', unit: 'g' },
		{ key: 'sodium_mg', label: 'Sodium', unit: 'mg' }
	];

	async function save() {
		const body = draftPayload(draft);
		if (!body.name) return toasts.error('Give the food a name');
		if (body.nutrients.kcal == null) return toasts.error('Calories are required');
		if (body.basis === 'per_serving' && !body.serving_grams) return toasts.error('Enter the serving size in grams');
		busy = true;
		try {
			if (isNew) {
				const created = await post<Food>('/api/foods', body);
				toasts.show(`Saved ${created.name}`);
			} else {
				await patch<Food>(`/api/foods/${id}`, body);
				toasts.show('Saved');
			}
			await goto('/foods');
		} catch (err) {
			toasts.error((err as Error).message);
		} finally {
			busy = false;
		}
	}

	async function remove() {
		if (!food || !confirm(`Delete ${food.name}? Past log entries keep their values.`)) return;
		busy = true;
		try {
			await del(`/api/foods/${food.id}`);
			toasts.show(`Deleted ${food.name}`);
			await goto('/foods');
		} catch (err) {
			toasts.error((err as Error).message);
		} finally {
			busy = false;
		}
	}

	async function pin() {
		if (!food) return;
		const p = portionPayload(portion);
		try {
			await post('/api/pins', {
				food_id: food.id,
				...(p.grams != null ? { grams: p.grams } : { servings: p.servings, serving_label: p.serving })
			});
			toasts.show(`Pinned ${food.name} to quick add`);
		} catch (err) {
			toasts.error((err as Error).message);
		}
	}
</script>

<svelte:head><title>{isNew ? 'New food' : (food?.name ?? 'Food')} · makan</title></svelte:head>

<header class="mb-4 flex items-center gap-1 pt-1">
	<a href="/foods" class="-ml-2 grid h-11 w-11 place-items-center rounded-full hover:bg-wash" aria-label="Back to foods">
		<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12.5 4.5L7 10l5.5 5.5" /></svg>
	</a>
	<h1 class="min-w-0 flex-1 truncate text-xl font-semibold tracking-tight">
		{isNew ? 'New household food' : (food?.name ?? '')}
	</h1>
</header>

{#if error}
	<p class="py-8 text-center text-critical-text">{error}</p>
{:else if isNew || food?.editable}
	<div class="card p-4">
		<FoodForm bind:draft />
	</div>
	<div class="mt-4 flex gap-2">
		{#if !isNew}
			<button class="btn btn-danger" onclick={remove} disabled={busy}>Delete</button>
			<button class="btn btn-ghost" onclick={pin} disabled={busy}>Pin</button>
		{/if}
		<button class="btn btn-primary ml-auto min-w-32" onclick={save} disabled={busy}>Save</button>
	</div>
{:else if food}
	<div class="space-y-4">
		<div class="text-[13px] text-ink-2">
			<div class="flex items-center gap-2"><SourceBadge source={food.source} /><span>{food.source_label}</span></div>
			{#if food.category}<div class="mt-1 text-muted">{food.category}</div>{/if}
		</div>
		{#if food.description}<p class="text-[14px] text-ink-2">{food.description}</p>{/if}
		<section class="card overflow-hidden">
			<h2 class="border-b border-line px-4 py-2.5 text-[13px] font-semibold text-ink-2">Per 100 g</h2>
			<table class="w-full text-[14px]">
				<tbody>
					{#each ROWS as r (r.key)}
						<tr class="border-b border-line last:border-0">
							<th scope="row" class="px-4 py-2 text-left font-normal text-ink-2">{r.label}</th>
							<td class="px-4 py-2 text-right tabular">
								{food.per_100g[r.key] == null ? '–' : `${Math.round((food.per_100g[r.key] ?? 0) * 10) / 10} ${r.unit}`}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>
		<section class="card p-4">
			<h2 class="mb-3 text-[15px] font-semibold">Pin to quick add</h2>
			<PortionPicker {food} bind:value={portion} />
			<button class="btn btn-primary mt-3 w-full" onclick={pin}>Pin this portion</button>
		</section>
		<p class="text-[13px] text-muted">Reference data is read-only. To change it, create a household food instead.</p>
	</div>
{:else}
	<div class="card h-64 animate-pulse"></div>
{/if}
