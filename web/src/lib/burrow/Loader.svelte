<script lang="ts">
	import { TRAIL, type TrailKind } from './art.js';

	let { kind = 'footprints', label }: { kind?: TrailKind; label?: string } = $props();

	const prints = $derived.by(() => {
		const T = TRAIL[kind] ?? TRAIL.footprints;
		let out = '';
		for (let i = 0; i < 7; i++) {
			out += `<g class="bh-loader__print" style="animation-delay:${(i * 0.2).toFixed(2)}s">${T.draw({ x: 10 + i * 16, y: 14, a: 0 }, i, 1)}</g>`;
		}
		return `<svg viewBox="0 0 120 28" width="120" height="28" aria-hidden="true" overflow="visible">${out}</svg>`;
	});
</script>

<div class="bh-loader" role="status">
	<span class="bh-loader__trail">{@html prints}</span>
	{#if label}<span class="bh-loader__label">{label}</span>{:else}<span class="sr-only">Loading</span>{/if}
</div>
