<script lang="ts">
	let {
		label,
		value,
		target,
		color,
		unit = 'g'
	}: { label: string; value: number; target: number | null; color: string; unit?: string } = $props();

	const pct = $derived(target && target > 0 ? Math.min(value / target, 1) : 0);
	const over = $derived(target != null && target > 0 && value > target);
</script>

<div class="min-w-0">
	<div class="flex items-baseline justify-between gap-2 text-[13px]">
		<span class="flex items-center gap-1.5 font-medium text-ink-2">
			<span class="inline-block h-2.5 w-2.5 rounded-full" style="background: {color}"></span>{label}
		</span>
	</div>
	<div class="mt-0.5 text-[15px] font-semibold">
		{Math.round(value)}<span class="font-normal text-muted">{target ? ` / ${Math.round(target)}` : ''} {unit}</span>
	</div>
	<div
		class="mt-1.5 h-1.5 w-full overflow-hidden rounded-full"
		style="background: color-mix(in oklab, {color} 20%, var(--surface))"
		role="meter"
		aria-label="{label} {Math.round(value)} of {target ? Math.round(target) : 'no target'} {unit}"
		aria-valuemin={0}
		aria-valuemax={target ?? undefined}
		aria-valuenow={Math.round(value)}
	>
		{#if target}
			<div class="h-full rounded-full" style="width: {pct * 100}%; background: {color}"></div>
		{/if}
	</div>
	{#if over && target}
		<div class="mt-1 text-[12px] text-ink-2">+{Math.round(value - target)} {unit} over</div>
	{:else if !target}
		<div class="mt-1 text-[12px] text-muted">No target</div>
	{/if}
</div>
