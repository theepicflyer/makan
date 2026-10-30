<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import FoodForm from '#lib/components/FoodForm.svelte';
	import NutrientIcon, { NUTRIENT_OF } from '#lib/components/NutrientIcon.svelte';
	import SourceBadge from '#lib/components/SourceBadge.svelte';
	import PortionPicker from '#lib/components/PortionPicker.svelte';
	import Breadcrumbs from '#lib/burrow/Breadcrumbs.svelte';
	import Icon from '#lib/burrow/Icon.svelte';
	import Loader from '#lib/burrow/Loader.svelte';
	import Peek from '#lib/burrow/Peek.svelte';
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
			toasts.show(`Deleted ${food.name}`, { character: 'kayu', mood: 'happy' });
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

<!-- a form and a label: they read best narrow, so wider screens don't stretch them, and half-folded they keep to the left of the fold -->
<div class="mk-page mk-top sm:max-w-3xl book:max-w-[env(viewport-segment-right_0_0)]">
	<header class="pt-5 pb-4">
		<Breadcrumbs items={[{ label: 'Foods', href: '/foods' }, { label: isNew ? 'New food' : (food?.name ?? 'Food') }]} />
		<h1 class="page-title mt-2">{isNew ? 'New household food' : (food?.name ?? '')}</h1>
	</header>

	{#if error}
		<p class="py-8 text-center font-semibold text-tomato-text">Couldn't load this food: {error}</p>
	{:else if isNew || food?.editable}
		<!-- editing is Kayu's job -->
		<Peek character="kayu" mood={busy ? 'busy' : 'happy'} size={72} offset={20}>
			<div class="bh-card"><FoodForm bind:draft /></div>
		</Peek>
		<div class="mt-4 flex items-center gap-1">
			{#if !isNew}
				<button class="bh-btn bh-btn--ghost mk-danger -ml-3" onclick={remove} disabled={busy}><Icon name="trash" size={18} />Delete</button>
				<button class="bh-btn bh-btn--ghost" onclick={pin} disabled={busy}><Icon name="pin" size={18} />Pin</button>
			{/if}
			<button class="bh-btn bh-btn--primary ml-auto min-w-32" onclick={save} disabled={busy}>Save food</button>
		</div>
	{:else if food}
		<div class="mk-stagger space-y-4">
			<div class="small text-ink-muted">
				<div class="flex items-center gap-2"><SourceBadge source={food.source} /><span>{food.source_label}</span></div>
				{#if food.category}<div class="mt-1">{food.category}</div>{/if}
			</div>
			{#if food.description}<p class="body text-ink-muted">{food.description}</p>{/if}
			<section class="bh-card py-2" aria-labelledby="per100-title">
				<h2 id="per100-title" class="bh-card__title pt-2 pb-1">Per 100 g</h2>
				<table class="body w-full">
					<tbody class="mk-stagger">
						{#each ROWS as r (r.key)}
							{@const symbol = NUTRIENT_OF[r.key]}
							<tr class="border-b border-line last:border-0">
								<!-- the symbol's slot is kept on every row so the names line up -->
								<th scope="row" class="py-2.5 text-left font-normal text-ink-muted">
									<span class="inline-block w-[22px]">{#if symbol}<NutrientIcon kind={symbol} />{/if}</span>{r.label}
								</th>
								<td class="bh-num py-2.5 text-right font-semibold">
									{food.per_100g[r.key] == null ? '–' : `${Math.round((food.per_100g[r.key] ?? 0) * 10) / 10} ${r.unit}`}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</section>
			<section class="bh-card" aria-labelledby="pin-title">
				<header class="bh-card__head"><h2 id="pin-title" class="bh-card__title">Pin to quick add</h2></header>
				<PortionPicker {food} bind:value={portion} />
				<button class="bh-btn bh-btn--primary mt-4 w-full" onclick={pin}><Icon name="pin" size={18} />Pin this portion</button>
			</section>
			<p class="small text-ink-muted">Reference data is read-only. To change it, create a household food instead.</p>
		</div>
	{:else}
		<div class="grid justify-items-center py-16"><Loader kind="crumbs" /></div>
	{/if}
</div>
