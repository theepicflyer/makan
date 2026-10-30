<script lang="ts">
	import { page } from '$app/state';
	import Icon from '../burrow/Icon.svelte';
	import Peek from '../burrow/Peek.svelte';
	import { NAV_ITEMS, navPeek } from '../nav.ts';
	import { slidingPill } from '../motion.ts';

	const path = $derived(page.url.pathname);
	const peek = $derived(navPeek(path));
</script>

{#snippet nav()}
	<nav class="bh-nav" aria-label="Main" {@attach slidingPill}>
		{#each NAV_ITEMS as item (item.label)}
			{@const active = item.match(path)}
			<a href={item.href()} class="bh-nav__item {active ? 'is-active' : ''}" aria-current={active ? 'page' : undefined}>
				<span class="bh-nav__pill"><Icon name={item.icon} size={22} /></span>
				<span class="bh-nav__label">{item.label}</span>
			</a>
		{/each}
	</nav>
{/snippet}

<!-- phones and tablets: desktop has the side rail. Half-folded, it keeps to the left of the fold. -->
<div class="mk-dock pointer-events-none fixed bottom-0 left-0 z-30 px-4 lg:hidden" style="right: var(--fold-right); padding-bottom: calc(env(safe-area-inset-bottom) + var(--nav-gap))">
	<div class="mx-auto max-w-lg">
		<!-- one nav for every screen, so its pill can slide; on day screens Bao ducks behind it -->
		<Peek character="bao" size={56} side="left" offset={20} class={peek ? '' : 'mk-peek--away'}>{@render nav()}</Peek>
	</div>
</div>

<style>
	.mk-dock :global(.bh-nav) {
		pointer-events: auto;
	}
</style>
