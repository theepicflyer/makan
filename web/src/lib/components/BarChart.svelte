<script lang="ts" module>
	export interface Bar {
		key: string;
		/** null when nothing was logged: drawn as a dot on the baseline. */
		value: number | null;
		/** Under the bar; labels that would collide with the one before are dropped. */
		label: string;
		/** Today: an accent bar and a bold label. */
		accent?: boolean;
		/** Read out for the bar under the keyboard. */
		aria: string;
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';

	/* Sticker bars from one baseline, with an optional dashed target and a trend line. One tab stop:
	   arrow keys move between bars, Enter picks one. Pointer hover or tap shows the tooltip. */
	let {
		bars,
		label,
		height = 180,
		color = 'var(--sunny)',
		target = null,
		line,
		floor = 0,
		axis = true,
		active = $bindable(null),
		tip,
		onpick
	}: {
		bars: Bar[];
		/** What the chart shows, for screen readers. */
		label: string;
		height?: number;
		color?: string;
		target?: number | null;
		/** A trend drawn over the bars, one value (or a gap) per bar. */
		line?: (number | null)[];
		/** The least the y axis runs to, so an empty or low chart keeps a sensible scale. */
		floor?: number;
		/** Draw the x labels; small multiples show them on the bottom chart only. */
		axis?: boolean;
		/** The bar under the pointer or keyboard; bindable so small multiples can share it. */
		active?: number | null;
		tip?: Snippet<[number]>;
		onpick?: (i: number) => void;
	} = $props();

	let width = $state(340);
	let box: HTMLDivElement | undefined = $state();
	let pointer = 'mouse';

	const PAD = $derived({ top: 12, right: 8, bottom: axis ? 26 : 6, left: 38 });
	const plotW = $derived(Math.max(0, width - PAD.left - PAD.right));
	const plotH = $derived(height - PAD.top - PAD.bottom);
	const band = $derived(bars.length ? plotW / bars.length : 0);
	const barW = $derived(Math.max(1.5, Math.min(24, band - (band >= 10 ? 4 : band >= 5 ? 2 : 1))));
	// thin bars lose the sticker outline, which would swallow them
	const outlined = $derived(barW >= 6);

	const maxVal = $derived(Math.max(target ?? 0, floor, ...bars.map((b) => b.value ?? 0), ...(line ?? []).map((v) => v ?? 0)));
	const step = $derived(niceStep(maxVal / (height < 140 ? 2 : 4)));
	const yMax = $derived(Math.ceil(maxVal / step) * step || step);
	const ticks = $derived(Array.from({ length: Math.round(yMax / step) + 1 }, (_, i) => i * step));
	const y = (v: number) => PAD.top + plotH - (v / yMax) * plotH;
	const cx = (i: number) => PAD.left + band * i + band / 2;

	function niceStep(raw: number): number {
		const pow = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
		const n = raw / pow;
		return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
	}

	function tickLabel(v: number): string {
		return v >= 1000 ? `${Math.round((v / 1000) * 10) / 10}K` : `${v}`;
	}

	function barPath(x: number, top: number, w: number, base: number): string {
		const r = Math.max(0, Math.min(6, w / 2, base - top));
		return `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${base} Z`;
	}

	// Keep every label, else every second, third… counting back from the latest, so the kept ones stay
	// evenly spaced and none collide (about 6.5px a character at 11px).
	const shown = $derived.by(() => {
		const at = bars.flatMap((b, i) => (b.label ? [i] : []));
		const fits = (kept: number[]) =>
			kept.every((i, j) => j === 0 || cx(i) - cx(kept[j - 1]) >= ((bars[i].label.length + bars[kept[j - 1]].label.length) * 6.5) / 2 + 6);
		for (let every = 1; every <= at.length; every++) {
			const kept = at.filter((_, j) => (at.length - 1 - j) % every === 0);
			if (fits(kept)) {
				const keep = new Set(kept);
				return bars.map((_, i) => keep.has(i));
			}
		}
		return bars.map(() => false);
	});

	// the trend as runs of points, broken where it has no value
	const linePath = $derived.by(() => {
		if (!line) return '';
		let d = '';
		let pen = false;
		line.forEach((v, i) => {
			if (v == null) {
				pen = false;
				return;
			}
			d += `${pen ? 'L' : 'M'}${cx(i).toFixed(1)},${y(v).toFixed(1)} `;
			pen = true;
		});
		return d;
	});

	const current = $derived(active != null && active < bars.length ? active : null);
	const tipX = $derived(current != null ? cx(current) : 0);

	function onkeydown(e: KeyboardEvent) {
		if (!bars.length) return;
		const at = current ?? bars.length - 1;
		if (e.key === 'ArrowLeft') active = Math.max(0, at - 1);
		else if (e.key === 'ArrowRight') active = Math.min(bars.length - 1, at + 1);
		else if (e.key === 'Home') active = 0;
		else if (e.key === 'End') active = bars.length - 1;
		else if (e.key === 'Enter' && current != null && onpick) onpick(current);
		else return;
		e.preventDefault();
	}
</script>

<div class="relative" bind:this={box} bind:clientWidth={width}>
	<!-- one tab stop for the chart: arrow keys move between bars and the live region below reads each one -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
	<svg
		{width}
		{height}
		role="img"
		aria-label="{label}. Use the arrow keys to read each bar."
		tabindex="0"
		class="block"
		{onkeydown}
		onfocus={() => (active ??= bars.length - 1)}
		onblur={() => (active = null)}
		onpointerleave={(e) => {
			if (e.pointerType === 'mouse') active = null;
		}}
	>
		{#each ticks as t (t)}
			<line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--ink-muted)' : 'var(--line)'} stroke-width={t === 0 ? 1.5 : 1} />
			<text x={PAD.left - 6} y={y(t) + 4} text-anchor="end" font-size="11" fill="var(--ink-muted)" class="tabular">{tickLabel(t)}</text>
		{/each}
		{#each bars as b, i (b.key)}
			{#if b.value != null && b.value > 0}
				<path
					d={barPath(cx(i) - barW / 2, y(b.value), barW, y(0))}
					fill={b.accent ? 'var(--accent)' : color}
					stroke={outlined ? 'var(--outline)' : 'none'}
					stroke-width="1.5"
					stroke-linejoin="round"
					opacity={current == null || current === i ? 1 : 0.4}
				/>
			{:else if b.value == null}
				<circle cx={cx(i)} cy={y(0) - 5} r={Math.max(1.2, Math.min(2.5, band / 3))} fill="var(--ink-muted)" />
			{/if}
			{#if axis && shown[i]}
				<text x={cx(i)} y={height - 8} text-anchor="middle" font-size="11" fill={b.accent ? 'var(--ink)' : 'var(--ink-muted)'} font-weight={b.accent ? 600 : 400}
					>{b.label}</text
				>
			{/if}
		{/each}
		{#if target}
			<!-- a surface halo keeps the target line readable where it crosses bars -->
			<line x1={PAD.left} x2={width - PAD.right} y1={y(target)} y2={y(target)} stroke="var(--surface)" stroke-width="5" pointer-events="none" />
			<line
				x1={PAD.left}
				x2={width - PAD.right}
				y1={y(target)}
				y2={y(target)}
				stroke="var(--ink)"
				stroke-width="2"
				stroke-dasharray="4 3"
				stroke-linecap="round"
				pointer-events="none"
			/>
		{/if}
		{#if linePath}
			<path d={linePath} fill="none" stroke="var(--surface)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" pointer-events="none" />
			<path d={linePath} fill="none" stroke="var(--sky-text)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" pointer-events="none" />
		{/if}
		{#if current != null && tip}
			<line x1={tipX} x2={tipX} y1={PAD.top} y2={y(0)} stroke="var(--ink-muted)" stroke-width="1" pointer-events="none" />
		{/if}
		{#each bars as b, i (b.key)}
			<!-- hit target: the whole band, taller than the bar -->
			<rect
				x={PAD.left + band * i}
				y={PAD.top}
				width={band}
				height={plotH}
				fill="transparent"
				class={onpick ? 'cursor-pointer' : ''}
				role="presentation"
				onpointerenter={(e) => {
					pointer = e.pointerType;
					active = i;
				}}
				onpointerdown={(e) => {
					pointer = e.pointerType;
					active = i;
				}}
				onclick={() => {
					// a tap shows the tooltip; a click (mouse or pen) opens the bar's day
					if (pointer !== 'touch') onpick?.(i);
				}}
			/>
		{/each}
	</svg>
	<span class="sr-only" aria-live="polite">{current != null ? bars[current].aria : ''}</span>
	{#if current != null && tip}
		<div
			class="small pointer-events-none absolute top-0 z-10 w-44 -translate-x-1/2 rounded-[var(--radius-md)] border-2 border-outline bg-surface px-3 py-2 shadow-[var(--shadow-lift)]"
			style="left: {Math.min(Math.max(tipX, 88), width - 88)}px"
		>
			{@render tip(current)}
		</div>
	{/if}
</div>
<svelte:window
	onpointerdown={(e) => {
		// small multiples share `active`, so a press anywhere in their group keeps it
		const scope = box?.closest('[data-chart-group]') ?? box;
		if (scope && !scope.contains(e.target as Node)) active = null;
	}}
/>
