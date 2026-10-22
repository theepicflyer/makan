<script lang="ts">
	import type { HistoryDay } from '../types.ts';
	import { kcal, parseDate } from '../format.ts';

	let { days, target, today }: { days: HistoryDay[]; target: number | null; today: string } = $props();

	let width = $state(340);
	let active = $state<number | null>(null);

	const HEIGHT = 180;
	const PAD = { top: 12, right: 8, bottom: 26, left: 34 };
	const plotW = $derived(Math.max(0, width - PAD.left - PAD.right));
	const plotH = HEIGHT - PAD.top - PAD.bottom;
	const band = $derived(days.length ? plotW / days.length : 0);
	const barW = $derived(Math.max(4, Math.min(24, band - 4)));

	const maxVal = $derived(Math.max(target ?? 0, ...days.map((d) => (d.entries ? (d.kcal ?? 0) : 0)), 500));
	const step = $derived(niceStep(maxVal / 4));
	const yMax = $derived(Math.ceil(maxVal / step) * step);
	const ticks = $derived(Array.from({ length: Math.round(yMax / step) + 1 }, (_, i) => i * step));
	const y = (v: number) => PAD.top + plotH - (v / yMax) * plotH;

	function niceStep(raw: number): number {
		const pow = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
		const n = raw / pow;
		return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
	}

	function tickLabel(v: number): string {
		return v >= 1000 ? `${Math.round((v / 1000) * 10) / 10}K` : `${v}`;
	}

	function xLabel(iso: string, i: number): string {
		const d = parseDate(iso);
		if (days.length <= 14) return d.toLocaleDateString('en-SG', { weekday: 'narrow' });
		return i % 5 === 0 || iso === today ? `${d.getDate()}` : '';
	}

	function barPath(x: number, top: number, w: number, base: number): string {
		const r = Math.min(6, w / 2, base - top);
		return `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${base} Z`;
	}

	const tip = $derived(active != null ? days[active] : null);
	const tipX = $derived(active != null ? PAD.left + band * active + band / 2 : 0);
</script>

{#if target}
	<div class="label mb-1 flex items-center justify-end gap-1.5 px-1 text-ink-muted">
		<svg width="18" height="4" aria-hidden="true"><line x1="1" x2="17" y1="2" y2="2" stroke="var(--ink)" stroke-width="2" stroke-dasharray="4 3" stroke-linecap="round" /></svg>Target {kcal(target)} kcal
	</div>
{/if}
<div class="relative" bind:clientWidth={width}>
	<svg {width} height={HEIGHT} role="img" aria-label="Daily calories{target ? ` against a ${Math.round(target)} kcal target` : ''}">
		{#each ticks as t (t)}
			<line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--ink-muted)' : 'var(--line)'} stroke-width={t === 0 ? 1.5 : 1} />
			<text x={PAD.left - 6} y={y(t) + 4} text-anchor="end" font-size="11" fill="var(--ink-muted)" class="tabular">{tickLabel(t)}</text>
		{/each}
		{#each days as d, i (d.date)}
			{@const cx = PAD.left + band * i + band / 2}
			{#if d.entries > 0}
				<!-- sticker bars: the sunflower's petal colour, today in makan's tomato -->
				<path
					d={barPath(cx - barW / 2, y(d.kcal ?? 0), barW, y(0))}
					fill={d.date === today ? 'var(--accent)' : 'var(--sunny)'}
					stroke="var(--outline)"
					stroke-width="1.5"
					stroke-linejoin="round"
					opacity={active == null || active === i ? 1 : 0.4}
				/>
			{:else}
				<circle cx={cx} cy={y(0) - 5} r="2.5" fill="var(--ink-muted)" />
			{/if}
			<text x={cx} y={HEIGHT - 8} text-anchor="middle" font-size="11" fill={d.date === today ? 'var(--ink)' : 'var(--ink-muted)'} font-weight={d.date === today ? 600 : 400}>{xLabel(d.date, i)}</text>
			<!-- hit target: the whole band, taller than the bar -->
			<rect
				x={PAD.left + band * i}
				y={PAD.top}
				width={band}
				height={plotH}
				fill="transparent"
				class="cursor-pointer outline-none"
				role="button"
				tabindex="0"
				aria-label="{parseDate(d.date).toDateString()}: {d.entries ? `${Math.round(d.kcal ?? 0)} kcal` : 'not logged'}"
				onpointerenter={() => (active = i)}
				onpointerdown={() => (active = i)}
				onfocus={() => (active = i)}
				onblur={() => (active = null)}
			/>
		{/each}
		{#if target}
			<!-- a surface halo keeps the target line readable where it crosses bars -->
			<line x1={PAD.left} x2={width - PAD.right} y1={y(target)} y2={y(target)} stroke="var(--surface)" stroke-width="5" pointer-events="none" />
			<line x1={PAD.left} x2={width - PAD.right} y1={y(target)} y2={y(target)} stroke="var(--ink)" stroke-width="2" stroke-dasharray="4 3" stroke-linecap="round" pointer-events="none" />
		{/if}
	</svg>
	{#if tip}
		<div
			class="small pointer-events-none absolute top-0 z-10 w-44 -translate-x-1/2 rounded-[var(--radius-md)] border-2 border-outline bg-surface px-3 py-2 shadow-[var(--shadow-lift)]"
			style="left: {Math.min(Math.max(tipX, 88), width - 88)}px"
		>
			<div class="text-ink-muted">{parseDate(tip.date).toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
			{#if tip.entries}
				<div class="body-strong bh-num">{kcal(tip.kcal)} kcal</div>
				<div class="bh-num mt-1 space-y-0.5 text-ink-muted">
					<div><span class="mk-dot" style="background: var(--protein)"></span><b class="text-ink">{Math.round(tip.protein_g ?? 0)} g</b> protein</div>
					<div><span class="mk-dot" style="background: var(--carbs)"></span><b class="text-ink">{Math.round(tip.carb_g ?? 0)} g</b> carbs</div>
					<div><span class="mk-dot" style="background: var(--fat)"></span><b class="text-ink">{Math.round(tip.fat_g ?? 0)} g</b> fat</div>
				</div>
			{:else}
				<div class="body-strong">Not logged</div>
			{/if}
		</div>
	{/if}
</div>
<svelte:window onpointerdown={(e) => { if (!(e.target as Element).closest?.('svg')) active = null; }} />
