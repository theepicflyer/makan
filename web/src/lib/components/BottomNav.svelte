<script lang="ts">
	import { page } from '$app/state';
	import Icon from '../burrow/Icon.svelte';
	import Peek from '../burrow/Peek.svelte';
	import { NAV_ITEMS, navPeek } from '../nav.ts';

	const path = $derived(page.url.pathname);
	const peek = $derived(navPeek(path));
</script>

{#snippet nav()}
	<nav class="bh-nav" aria-label="Main">
		{#each NAV_ITEMS as item (item.label)}
			{@const active = item.match(path)}
			<a href={item.href()} class="bh-nav__item {active ? 'is-active' : ''}" aria-current={active ? 'page' : undefined}>
				<span class="bh-nav__pill"><Icon name={item.icon} size={22} /></span>
				<span class="bh-nav__label">{item.label}</span>
			</a>
		{/each}
	</nav>
{/snippet}

<!-- phones only: desktop has the side rail -->
<div class="mk-dock pointer-events-none fixed inset-x-0 bottom-0 z-30 px-4 lg:hidden" style="padding-bottom: calc(env(safe-area-inset-bottom) + var(--nav-gap))">
	<div class="mx-auto max-w-lg">
		{#if peek}
			<Peek character="bao" size={56} side="left" offset={20}>{@render nav()}</Peek>
		{:else}
			{@render nav()}
		{/if}
	</div>
</div>

<style>
	.mk-dock :global(.bh-nav) {
		pointer-events: auto;
	}
</style>
