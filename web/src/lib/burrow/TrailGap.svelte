<script lang="ts">
	import { trailSVG, type TrailKind } from './art.js';

	/* A short trail across the gap between two stacked blocks; from/to are 0..1 of the width. */
	let {
		kind,
		from = 0.2,
		to = 0.8,
		height = 52,
		fade,
		done,
		animate = true
	}: { kind: TrailKind; from?: number; to?: number; height?: number; fade?: number; done?: number; animate?: boolean } = $props();

	let width = $state(0);
	const svg = $derived.by(() => {
		const w = width || 320;
		const f = from * w;
		const t = to * w;
		const d = t - f;
		return trailSVG({
			kind,
			width: w,
			height,
			fade,
			done,
			points: [
				[f, 4],
				[f + d * 0.35, height * 0.38],
				[t - d * 0.35, height * 0.62],
				[t, height - 4]
			]
		});
	});
</script>

<div class="bh-trailgap {animate ? 'bh-trail--animate' : ''}" style="height: {height}px" aria-hidden="true" bind:clientWidth={width}>
	{@html svg}
</div>
