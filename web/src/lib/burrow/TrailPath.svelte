<script lang="ts" module>
	/* A wandering walk down the page: the heading drifts left and right (a slow swing plus a smaller wobble),
	   steering back from the edges, then eases into the end point. It is laid out by distance walked, so a
	   page that grows only extends its trail. Returns the points and the distance walked to each. */
	function wander(w: number, h: number, from: number, to: number, seed: number) {
		const step = 12;
		const edge = w * 0.1;
		const points: [number, number][] = [];
		const walked: number[] = [];
		let x = from * w;
		let y = 0;
		let s = 0;
		while (y < h) {
			points.push([x, y]);
			walked.push(s);
			// heading in radians away from straight down; positive turns right
			let a = 1.05 * Math.sin(s / 150 + seed * 2.4) + 0.45 * Math.sin(s / 61 + seed * 1.3);
			a += 1.6 * (Math.max(0, (edge - x) / edge) - Math.max(0, (x - (w - edge)) / edge));
			a = Math.max(-1.25, Math.min(1.25, a));
			x += Math.sin(a) * step;
			y += Math.cos(a) * step;
			s += step;
		}
		points.push([x, h]);
		walked.push(s);
		const ease = (t: number) => t * t * (3 - 2 * t);
		const land = Math.min(160, h / 3);
		for (const p of points) {
			if (p[1] > h - land) p[0] += (to * w - p[0]) * ease((p[1] - (h - land)) / land);
		}
		return { points, walked };
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { trailSVG, type TrailKind } from './art.js';

	/* One trail winding down a screen behind its cards: the cards hide it and the gaps between them show it.
	   It is full strength down to the element marked data-trail-end (the next thing to do) and faint after. */
	let {
		kind,
		from = 0.5,
		to = 0.5,
		toPx,
		seed = 1,
		class: cls = '',
		children
	}: {
		kind: TrailKind;
		/** Where the trail starts and ends across the width, 0..1; `toPx` pins the end in pixels instead. */
		from?: number;
		to?: number;
		toPx?: number;
		/** Picks the shape of the meander, so screens don't all wind the same way. */
		seed?: number;
		class?: string;
		children: Snippet;
	} = $props();

	let box: HTMLDivElement | undefined = $state();
	let width = $state(0);
	let height = $state(0);
	// Draw in step by step once, when the screen opens; later resizes just redraw.
	let fresh = $state(true);

	const svg = $derived.by(() => {
		if (!box || !width || !height) return '';
		const { points, walked } = wander(width, height, from, toPx != null ? toPx / width : to, seed);
		// full strength for the share of the walk that reaches the next thing to do
		const end = box.querySelector<HTMLElement>('[data-trail-end]');
		const at = end ? points.findIndex(([, y]) => y >= end.offsetTop + 28) : -1;
		const done = at < 0 ? 1 : walked[at] / walked[walked.length - 1];
		return trailSVG({ kind, width, height, fade: 0.45, done, points });
	});

	$effect(() => {
		if (!svg || !fresh) return;
		const t = setTimeout(() => (fresh = false), 3500);
		return () => clearTimeout(t);
	});
</script>

<!-- while fresh, the cards rise in one after another (layout.css); one added later just rises -->
<div bind:this={box} class="mk-trailpath {fresh ? 'is-fresh' : ''} {cls}" bind:clientWidth={width} bind:clientHeight={height}>
	<div class="mk-trailpath__art bh-trail {fresh ? 'bh-trail--animate' : ''}" aria-hidden="true">{@html svg}</div>
	{@render children()}
</div>
