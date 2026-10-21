<script lang="ts">
	import Meter from './Meter.svelte';
	import type { Nutrients, Targets } from '../types.ts';
	import { kcal } from '../format.ts';

	let { totals, targets }: { totals: Nutrients; targets: Targets } = $props();

	const eaten = $derived(totals.kcal ?? 0);
	const target = $derived(targets.kcal);
	const remaining = $derived(target != null ? target - eaten : null);
	const pct = $derived(target && target > 0 ? Math.min(eaten / target, 1) : 0);
	const over = $derived(remaining != null && remaining < 0);
</script>

<section class="card p-4" aria-label="Day summary">
	<div class="flex items-end justify-between gap-3">
		<div>
			<div class="text-[13px] font-medium text-ink-2">Calories</div>
			<div class="text-[40px] leading-none font-semibold tracking-tight">
				{kcal(eaten)}<span class="ml-1 text-base font-normal text-muted">kcal</span>
			</div>
		</div>
		<div class="text-right text-[13px] leading-snug">
			{#if target != null && remaining != null}
				{#if over}
					<div class="flex items-center justify-end gap-1 font-semibold">
						<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5l7 13H1z" fill="var(--serious)" /><path d="M8 6v4M8 12v.5" stroke="#fff" stroke-width="1.6" stroke-linecap="round" /></svg>
						{kcal(-remaining)} over
					</div>
				{:else}
					<div class="font-semibold">{kcal(remaining)} left</div>
				{/if}
				<div class="text-muted">of {kcal(target)}</div>
			{:else}
				<a href="/settings" class="text-ink-2 underline underline-offset-2">Set a target</a>
			{/if}
		</div>
	</div>
	<div
		class="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-grid"
		role="meter"
		aria-label="Calories {Math.round(eaten)} of {target ?? 'no target'}"
		aria-valuemin={0}
		aria-valuemax={target ?? undefined}
		aria-valuenow={Math.round(eaten)}
	>
		<div
			class="h-full rounded-full transition-[width] duration-300"
			style="width: {target ? pct * 100 : 0}%; background: {over ? 'var(--serious)' : 'var(--ink)'}"
		></div>
	</div>
	<div class="mt-4 grid grid-cols-3 gap-4">
		<Meter label="Protein" value={totals.protein_g ?? 0} target={targets.protein_g} color="var(--protein)" />
		<Meter label="Carbs" value={totals.carb_g ?? 0} target={targets.carb_g} color="var(--carb)" />
		<Meter label="Fat" value={totals.fat_g ?? 0} target={targets.fat_g} color="var(--fat)" />
	</div>
</section>
