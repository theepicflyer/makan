<script lang="ts">
	import { goto } from '$app/navigation';
	import Field from '#lib/burrow/Field.svelte';
	import Habitat from '#lib/burrow/Habitat.svelte';
	import Icon from '#lib/burrow/Icon.svelte';
	import TrailPath from '#lib/burrow/TrailPath.svelte';
	import { get, patch, post } from '#lib/api.ts';
	import type { Me, Usage } from '#lib/types.ts';
	import { session, toasts, wide } from '#lib/state.svelte.ts';
	import { onMount } from 'svelte';

	type Manifest = Record<string, Record<string, unknown>>;

	let name = $state(session.me?.name ?? '');
	let targets = $state({
		kcal: session.me?.targets.kcal ?? null,
		protein_g: session.me?.targets.protein_g ?? null,
		carb_g: session.me?.targets.carb_g ?? null,
		fat_g: session.me?.targets.fat_g ?? null
	});
	let usage = $state<Usage | null>(null);
	let manifest = $state<Manifest | null>(null);
	let busy = $state(false);

	onMount(async () => {
		get<Usage>('/api/usage').then((u) => (usage = u)).catch(() => {});
		get<{ reference: Manifest }>('/api/about')
			.then((a) => (manifest = a.reference ?? {}))
			.catch(() => (manifest = {}));
	});

	const macroKcal = $derived(
		(Number(targets.protein_g) || 0) * 4 + (Number(targets.carb_g) || 0) * 4 + (Number(targets.fat_g) || 0) * 9
	);

	function num(v: unknown): number | null {
		return v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v);
	}

	async function save() {
		busy = true;
		try {
			session.me = await patch<Me>('/api/me', {
				name: name.trim() || undefined,
				targets: {
					kcal: num(targets.kcal),
					protein_g: num(targets.protein_g),
					carb_g: num(targets.carb_g),
					fat_g: num(targets.fat_g)
				}
			});
			toasts.show('Targets saved', { character: 'kayu' });
		} catch (err) {
			toasts.error((err as Error).message);
		} finally {
			busy = false;
		}
	}

	async function logout() {
		await post('/api/auth/logout');
		session.me = null;
		await goto('/login');
	}

	const sg = $derived(manifest?.sgfoodid as Record<string, unknown> | undefined);
	const usda = $derived(manifest?.usda as Record<string, unknown> | undefined);
	const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
	const sgNotice = $derived(
		`Contains information from Singapore Food Insights Database (SG FoodID) accessed on ${str(sg?.accessed) || 'the date of snapshot'} from Health Promotion Board which is made available under the terms found at https://pphtpc.hpb.gov.sg/web/sgfoodid. The information contained within this dataset is provided on an "as-is" basis. The data, including but not limited to nutritional information, is subject to inherent limitations. No warranty or representation is made as to the accuracy or completeness of the data contained herein.`
	);
</script>

<svelte:head><title>Settings · makan</title></svelte:head>

<Habitat kind="river" mood={busy ? 'busy' : 'happy'} class="mk-top">
	<p class="small text-ink-muted">Signed in as {session.me?.name}</p>
	<h1 class="page-title">Settings</h1>
</Habitat>

{#snippet targetsCard()}
	<section class="bh-card grid gap-4" aria-labelledby="targets-title">
		<header class="bh-card__head mb-0"><h2 id="targets-title" class="bh-card__title">You and your targets</h2></header>
		<Field label="Your name" bind:value={name} />
		<div class="grid grid-cols-2 gap-3">
			<Field label="Calories" nutrient="energy" suffix="kcal" type="number" inputmode="numeric" min="0" bind:value={targets.kcal} />
			<Field label="Protein" nutrient="protein" suffix="g" type="number" inputmode="numeric" min="0" bind:value={targets.protein_g} />
			<Field label="Carbs" nutrient="carbs" suffix="g" type="number" inputmode="numeric" min="0" bind:value={targets.carb_g} />
			<Field label="Fat" nutrient="fat" suffix="g" type="number" inputmode="numeric" min="0" bind:value={targets.fat_g} />
		</div>
		{#if macroKcal > 0}
			<p class="small text-ink-muted">These macros add up to about {Math.round(macroKcal).toLocaleString('en-SG')} kcal.</p>
		{/if}
		<button class="bh-btn bh-btn--primary w-full" onclick={save} disabled={busy}>Save targets</button>
	</section>
{/snippet}

{#snippet usageCard()}
	<section class="bh-card" aria-labelledby="usage-title">
		<header class="bh-card__head mb-1"><h2 id="usage-title" class="bh-card__title">Assistant usage</h2></header>
		{#if usage}
			<p class="body text-ink-muted">
				<span class="card-title bh-num text-ink">${usage.month_usd < 1 ? usage.month_usd.toFixed(3) : usage.month_usd.toFixed(2)}</span>
				this month across {usage.turns} message{usage.turns === 1 ? '' : 's'}
			</p>
			<p class="small mt-1 text-ink-muted">Model: {usage.model}</p>
		{:else}
			<p class="body text-ink-muted">–</p>
		{/if}
	</section>
{/snippet}

{#snippet sourcesCard()}
	<section class="bh-card small space-y-3 text-ink-muted" aria-labelledby="sources-title">
		<h2 id="sources-title" class="bh-card__title">Data sources</h2>
		<div>
			<p class="body-strong text-ink">Singapore Food Insights Database (SG FoodID)</p>
			<p class="mk-well mt-1 leading-relaxed">{sgNotice}</p>
			{#if sg?.items}<p class="mt-1">{str(sg.items)} items · Health Promotion Board, Singapore</p>{/if}
		</div>
		<div>
			<p class="body-strong text-ink">USDA FoodData Central</p>
			<p class="mt-1 leading-relaxed">
				{str(usda?.attribution) || 'U.S. Department of Agriculture, Agricultural Research Service. FoodData Central. fdc.nal.usda.gov.'}
			</p>
			{#if usda}
				<p class="mt-1">
					{usda.items ? `${str(usda.items)} items` : ''}{usda.licence ? ` · ${str(usda.licence)}` : ''}{usda.accessed ? ` · accessed ${str(usda.accessed)}` : ''}
				</p>
			{/if}
		</div>
		<p>Nutrition values are estimates. They are not medical advice.</p>
	</section>
{/snippet}

{#snippet signOut()}
	<button class="bh-btn bh-btn--secondary w-full" onclick={logout}><Icon name="sign-out" size={18} />Sign out</button>
{/snippet}

<div class="mk-page">
	{#if wide.current}
		<!-- desktop: you on the left, the app on the right, Kayu's chips winding behind both -->
		<TrailPath kind="chips" from={0.5} to={0.25} seed={4} class="grid grid-cols-2 items-start gap-9 pt-9">
			<div class="grid gap-9">
				{@render targetsCard()}
				{@render signOut()}
			</div>
			<div class="grid gap-9">
				{@render usageCard()}
				{@render sourcesCard()}
			</div>
		</TrailPath>
	{:else}
		<!-- Kayu's wood chips wind down from the river behind the cards -->
		<TrailPath kind="chips" from={0.6} to={0.5} seed={4} class="grid gap-9 pt-9">
			{@render targetsCard()}
			{@render usageCard()}
			{@render sourcesCard()}
			{@render signOut()}
		</TrailPath>
	{/if}
</div>
