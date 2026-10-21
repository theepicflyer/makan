<script lang="ts">
	import { goto } from '$app/navigation';
	import { get, patch, post } from '#lib/api.ts';
	import type { Me, Usage } from '#lib/types.ts';
	import { session, toasts } from '#lib/state.svelte.ts';
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
			toasts.show('Saved');
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

<h1 class="mb-4 pt-1 text-2xl font-semibold tracking-tight">Settings</h1>

<div class="space-y-4">
	<section class="card space-y-4 p-4">
		<label class="block"><span class="label">Your name</span><input class="field" bind:value={name} /></label>
		<div>
			<h2 class="label">Daily targets</h2>
			<div class="grid grid-cols-2 gap-3">
				<label class="block"><span class="label font-normal">Calories (kcal)</span><input class="field tabular" type="number" inputmode="numeric" min="0" bind:value={targets.kcal} /></label>
				<label class="block"><span class="label font-normal"><span class="mr-1 inline-block h-2 w-2 rounded-full bg-protein"></span>Protein (g)</span><input class="field tabular" type="number" inputmode="numeric" min="0" bind:value={targets.protein_g} /></label>
				<label class="block"><span class="label font-normal"><span class="mr-1 inline-block h-2 w-2 rounded-full bg-carb"></span>Carbs (g)</span><input class="field tabular" type="number" inputmode="numeric" min="0" bind:value={targets.carb_g} /></label>
				<label class="block"><span class="label font-normal"><span class="mr-1 inline-block h-2 w-2 rounded-full bg-fat"></span>Fat (g)</span><input class="field tabular" type="number" inputmode="numeric" min="0" bind:value={targets.fat_g} /></label>
			</div>
			{#if macroKcal > 0}
				<p class="mt-2 text-[13px] text-muted">These macros add up to about {Math.round(macroKcal).toLocaleString('en-SG')} kcal.</p>
			{/if}
		</div>
		<button class="btn btn-primary w-full" onclick={save} disabled={busy}>Save</button>
	</section>

	<section class="card p-4">
		<h2 class="text-[15px] font-semibold">Assistant usage</h2>
		{#if usage}
			<p class="mt-1 text-[14px] text-ink-2">
				<span class="text-xl font-semibold text-ink">${usage.month_usd < 1 ? usage.month_usd.toFixed(3) : usage.month_usd.toFixed(2)}</span> this month across {usage.turns} message{usage.turns === 1 ? '' : 's'}
			</p>
			<p class="mt-0.5 text-[13px] text-muted">Model: {usage.model}</p>
		{:else}
			<p class="mt-1 text-[14px] text-muted">–</p>
		{/if}
	</section>

	<section class="card space-y-3 p-4 text-[13px] text-ink-2">
		<h2 class="text-[15px] font-semibold text-ink">Data sources</h2>
		<div>
			<p class="font-medium text-ink">Singapore Food Insights Database (SG FoodID)</p>
			<p class="mt-1 rounded-xl bg-wash px-3 py-2 leading-relaxed">{sgNotice}</p>
			{#if sg?.items}<p class="mt-1 text-muted">{str(sg.items)} items · Health Promotion Board, Singapore</p>{/if}
		</div>
		<div>
			<p class="font-medium text-ink">USDA FoodData Central</p>
			<p class="mt-1 leading-relaxed">
				{str(usda?.attribution) || 'U.S. Department of Agriculture, Agricultural Research Service. FoodData Central. fdc.nal.usda.gov.'}
			</p>
			{#if usda}
				<p class="mt-1 text-muted">
					{usda.items ? `${str(usda.items)} items` : ''}{usda.licence ? ` · ${str(usda.licence)}` : ''}{usda.accessed ? ` · accessed ${str(usda.accessed)}` : ''}
				</p>
			{/if}
		</div>
		<p class="text-muted">Nutrition values are estimates. They are not medical advice.</p>
	</section>

	<button class="btn btn-ghost w-full" onclick={logout}>Sign out</button>
</div>
