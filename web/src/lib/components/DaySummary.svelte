<script lang="ts">
	import Meter from '../burrow/Meter.svelte';
	import Ring from '../burrow/Ring.svelte';
	import TrailGap from '../burrow/TrailGap.svelte';
	import type { Nutrients, Targets } from '../types.ts';
	import { kcal } from '../format.ts';

	let { totals, targets }: { totals: Nutrients; targets: Targets } = $props();

	const eaten = $derived(totals.kcal ?? 0);
	const target = $derived(targets.kcal);
	const remaining = $derived(target != null ? target - eaten : null);
	const over = $derived(remaining != null && remaining < 0);
</script>

<!-- the sunflower: a petal opens for each share of the target eaten; the middle shows what's left -->
<div class="grid justify-items-center pt-3">
	<Ring value={eaten} max={target} label="Calories">
		{#if remaining != null}
			<span class="mk-hero">{kcal(Math.abs(remaining))}</span>
			<span class="small">{over ? 'kcal over' : 'kcal left'}</span>
		{:else}
			<span class="mk-hero">{kcal(eaten)}</span>
			<span class="small">kcal eaten</span>
		{/if}
	</Ring>
	<p class="small mt-2 text-center text-ink-muted">
		{#if target != null}
			<span class="bh-num">{kcal(eaten)} of {kcal(target)}</span> kcal eaten
		{:else}
			<a class="mk-link" href="/settings">Set a daily target</a>
		{/if}
	</p>
</div>

<TrailGap kind="crumbs" from={0.5} to={0.14} height={44} />

<section class="bh-card" aria-labelledby="macros-title">
	<header class="bh-card__head"><h2 id="macros-title" class="bh-card__title">Macros</h2></header>
	<div class="grid gap-3.5">
		<Meter label="Protein" value={totals.protein_g ?? 0} max={targets.protein_g} color="protein" cap="sunflower" />
		<Meter label="Carbs" value={totals.carb_g ?? 0} max={targets.carb_g} color="carbs" cap="sunflower" />
		<Meter label="Fat" value={totals.fat_g ?? 0} max={targets.fat_g} color="fat" cap="sunflower" />
	</div>
</section>
