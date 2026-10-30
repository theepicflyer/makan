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
	<p class="small mt-2 text-center text-ink-muted">
		{#if target != null}
			<span class="bh-num"><Count value={eaten} format={kcal} /> of {kcal(target)}</span> kcal eaten
		{:else}
			<a class="mk-link" href="/settings">Set a daily target</a>
		{/if}
	</p>
</div>
