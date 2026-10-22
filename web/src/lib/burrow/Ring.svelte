<script lang="ts">
	import type { Snippet } from 'svelte';

	/* Burrow's sunflower ring: a petal opens for each share of the target, the centre shows what's left. */
	let {
		value,
		max,
		size = 208,
		label,
		children
	}: { value: number; max: number | null; size?: number; label: string; children?: Snippet } = $props();

	const PETALS = 22;
	const c = $derived(size / 2);
	const pct = $derived(max && max > 0 ? Math.max(0, Math.min(1, value / max)) : 0);
	const open = $derived(Math.round(pct * PETALS));
	const head = $derived(size * 0.27);
	const reach = $derived(size * 0.375);
	const seeds = $derived.by(() => {
		const out: [number, number][] = [];
		for (let i = 20; i < 220; i++) {
			const r = head * Math.sqrt(i / 220);
			if (r < head * 0.74) continue;
			const th = i * 2.39996;
			out.push([c + r * Math.cos(th), c + r * Math.sin(th)]);
		}
		return out;
	});
</script>

<div
	class="bh-ring bh-ring--sunflower"
	style="width: {size}px; height: {size}px"
	role="meter"
	aria-label={label}
	aria-valuemin={0}
	aria-valuemax={max ?? undefined}
	aria-valuenow={Math.round(value)}
>
	<svg width={size} height={size} viewBox="0 0 {size} {size}" aria-hidden="true">
		{#each { length: PETALS } as _, i (i)}
			<ellipse
				class="bh-petal {i < open ? 'is-on' : ''}"
				cx={c}
				cy={c - reach}
				rx={size * 0.046}
				ry={size * 0.11}
				transform="rotate({(i * 360) / PETALS} {c} {c})"
			/>
		{/each}
		<circle class="bh-seedhead" cx={c} cy={c} r={head} />
		{#each seeds as [x, y], i (i)}
			<circle class="bh-seedhead__seed" cx={x} cy={y} r={size * 0.0085} />
		{/each}
	</svg>
	<div class="bh-ring__center" style="width: {size}px; height: {size}px">{@render children?.()}</div>
</div>
