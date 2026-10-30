<script lang="ts">
	import Trace from './Trace.svelte';
	import NutrientIcon, { type Nutrient } from '../components/NutrientIcon.svelte';
	import Count from '../components/Count.svelte';
	import type { TraceName } from './art.js';

	let {
		label,
		value,
		max,
		unit = 'g',
		color = 'accent',
		cap,
		nutrient,
		overIsGood = false
	}: {
		label: string;
		value: number;
		max: number | null;
		unit?: string;
		color?: string;
		cap?: TraceName;
		nutrient?: Nutrient;
		/** Going past the target is fine (protein): the overflow keeps the nutrient's colour and the note isn't a warning. */
		overIsGood?: boolean;
	} = $props();

	const target = $derived(max != null && max > 0 ? max : null);
	// over only once the numbers shown differ, so 65.4 of 65 g doesn't read "0 g over"
	const over = $derived(target != null && Math.round(value) > Math.round(target));
	// Over target the track stretches to the value, so the target sits part way along and the overflow shows how far past it is.
	const scale = $derived(target ? (over ? value : target) : 1);
	const pct = $derived(target ? Math.max(0, Math.min(1, value / scale)) : 0);
	const targetPct = $derived(target ? target / scale : 1);
</script>

<div class="bh-meter {over ? 'is-over' : ''}">
	<div class="bh-meter__top">
		<span class="bh-meter__label">{#if nutrient}<NutrientIcon kind={nutrient} size={14} />{/if}{label}</span>
		<span class="bh-meter__value"
			><Count {value} />{target ? ` / ${Math.round(target)}` : ''} {unit}{#if over && target}<span class={overIsGood ? 'meter-over-good' : 'bh-meter__over'}>
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
			{#if over}
				<div class="meter-split" style="--w: {pct * 100}%">
					<div class="bh-meter__fill" style="--w: {(targetPct / pct) * 100}%; background: var(--{color})"></div>
					<div class="bh-meter__fill meter-overflow" style="background: var(--{overIsGood ? color : 'tomato'})"></div>
				</div>
			{:else}
				<div class="bh-meter__fill" style="--w: {pct * 100}%; background: var(--{color})"></div>
			{/if}
		</div>
		{#if over}
			<span class="meter-target" style="left: {targetPct * 100}%" aria-hidden="true"></span>
		{/if}
		{#if cap && target}
			<!-- the sunflower rolls along to the end of the fill -->
			<Trace name={cap} size={24} class="bh-meter__cap" style="--w: {pct * 100}%; --p: {pct}" />
		{/if}
	</div>
</div>

<style>
	.meter-split {
		display: flex;
		width: var(--w);
		height: 100%;
		transition: width 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
	}
	.meter-split > :global(.bh-meter__fill:first-child) {
		flex: none;
		border-radius: var(--radius-pill) 0 0 var(--radius-pill);
	}
	.meter-overflow {
		flex: 1;
		border-radius: 0 var(--radius-pill) var(--radius-pill) 0;
	}
	/* where the target is, once the bar runs past it */
	.meter-target {
		position: absolute;
		top: -3px;
		bottom: -3px;
		width: 2px;
		margin-left: -1px;
		border-radius: 1px;
		background: var(--outline);
	}
	.meter-over-good {
		color: var(--mint-text);
		font-weight: 600;
	}
</style>
