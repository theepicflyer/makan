<script lang="ts">
	import Ring from '../burrow/Ring.svelte';
	import Count from './Count.svelte';
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
			<span class="mk-hero"><Count value={Math.abs(remaining)} format={kcal} /></span>
			<span class="small">{over ? 'kcal over' : 'kcal left'}</span>
		{:else}
			<span class="mk-hero"><Count value={eaten} format={kcal} /></span>
			<span class="small">kcal eaten</span>
		{/if}
	</Ring>
	<div class="mt-2 flex justify-center">
		{#if target != null}
			<span class="bh-tag bh-tag--lg"><Count value={eaten} format={kcal} /> of {kcal(target)} kcal eaten</span>
		{:else}
			<a class="bh-btn bh-btn--secondary bh-btn--sm" href="/settings">Set a daily target</a>
		{/if}
	</div>
</div>
