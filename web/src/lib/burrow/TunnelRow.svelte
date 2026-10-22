<script lang="ts">
	import type { Snippet } from 'svelte';
	import { along, printAt } from './art.js';

	/* One chamber of Gali's tunnel: wrap rows in <div class="bh-tunnel">, newest first. */
	let {
		day,
		month,
		title,
		last = false,
		children
	}: { day: string; month: string; title?: string; last?: boolean; children?: Snippet } = $props();

	const prints = $derived(
		last
			? ''
			: along(
					[
						[32, 46],
						[24, 70],
						[40, 96],
						[32, 124]
					],
					15
				)
					.map((q, k) => {
						const r = ((q.a + 90) * Math.PI) / 180;
						const sd = k % 2 ? 1 : -1;
						return `<g class="bh-tunnel__print">${printAt(q.x + Math.cos(r) * sd * 4, q.y + Math.sin(r) * sd * 4, 0.5, q.a + 90)}</g>`;
					})
					.join('')
	);
	const rail = $derived(
		`<svg viewBox="0 0 64 124" preserveAspectRatio="xMidYMin meet" width="64" height="100%" overflow="visible" aria-hidden="true">` +
			(last ? '' : '<path class="hb-tunnel" d="M32 40 C24 64 42 92 32 130 V600"/>') +
			prints +
			'<ellipse class="hb-chamber" cx="32" cy="24" rx="24" ry="17"/></svg>'
	);
</script>

<div class="bh-tunnel__row">
	<span class="bh-tunnel__rail">{@html rail}</span>
	<span class="bh-tunnel__day"><span class="bh-tunnel__num">{day}</span><span class="bh-tunnel__mon">{month}</span></span>
	<div class="bh-tunnel__body">
		{#if title}<span class="bh-tunnel__title">{title}</span>{/if}
		{@render children?.()}
	</div>
</div>
