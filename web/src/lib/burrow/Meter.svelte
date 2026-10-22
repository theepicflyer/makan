<script lang="ts">
	import Trace from './Trace.svelte';
	import type { TraceName } from './art.js';

	let {
		label,
		value,
		max,
		unit = 'g',
		color = 'accent',
		cap
	}: { label: string; value: number; max: number | null; unit?: string; color?: string; cap?: TraceName } = $props();

	const target = $derived(max != null && max > 0 ? max : null);
	const pct = $derived(target ? Math.max(0, Math.min(1, value / target)) : 0);
	const over = $derived(target != null && value > target);
</script>

<div class="bh-meter {over ? 'is-over' : ''}">
	<div class="bh-meter__top">
		<span class="bh-meter__label">{label}</span>
		<span class="bh-meter__value"
			>{Math.round(value)}{target ? ` / ${Math.round(target)}` : ''} {unit}{#if over && target}<span class="bh-meter__over">
					· {Math.round(value - target)} {unit} over</span
				>{:else if !target}<span> · no target</span>{/if}</span
		>
	</div>
	<div class="bh-meter__rail">
		<div
			class="bh-meter__track"
			role="meter"
			aria-label={label}
			aria-valuemin={0}
			aria-valuemax={target ?? undefined}
			aria-valuenow={Math.round(value)}
		>
			<div class="bh-meter__fill" style="width: {pct * 100}%; background: var(--{over ? 'tomato' : color})"></div>
		</div>
		{#if cap && target}
			<Trace name={cap} size={24} class="bh-meter__cap" style="left: {pct * 100}%" />
		{/if}
	</div>
</div>
