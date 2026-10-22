<script lang="ts">
	import Trace from './Trace.svelte';

	let {
		items,
		kind = 'crumbs'
	}: { items: { label: string; href?: string }[]; kind?: 'crumbs' | 'footprints' | 'acorns' } = $props();

	const sep = $derived(kind === 'footprints' ? 'footprint' : kind === 'acorns' ? 'acorn' : 'crumbs');
</script>

<nav class="bh-crumbs" aria-label="Breadcrumb">
	<ol>
		{#each items as item, i (i)}
			<li>
				{#if i > 0}<Trace name={sep} size={16} class="bh-crumbs__sep" />{/if}
				{#if i === items.length - 1}
					<span aria-current="page">{item.label}</span>
				{:else}
					<a href={item.href}>{item.label}</a>
				{/if}
			</li>
		{/each}
	</ol>
</nav>
