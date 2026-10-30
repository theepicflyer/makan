<script lang="ts">
	import { page } from '$app/state';
	import Icon from '../burrow/Icon.svelte';
	import Peek from '../burrow/Peek.svelte';
	import { NAV_ITEMS, navPeek } from '../nav.ts';
	import { session } from '../state.svelte.ts';
	import { slidingPill } from '../motion.ts';

	const path = $derived(page.url.pathname);
	const peek = $derived(navPeek(path));
</script>

{#snippet nav()}
	<nav class="mk-rail__card" aria-label="Main" {@attach slidingPill}>
		<a href={NAV_ITEMS[0].href()} class="mk-rail__brand"><img src="/icons/icon.svg" alt="" width="32" height="32" />makan</a>
		{#each NAV_ITEMS as item (item.label)}
			{@const active = item.match(path)}
			<a href={item.href()} class="mk-rail__item {active ? 'is-active' : ''}" aria-current={active ? 'page' : undefined}>
				<span class="bh-nav__pill"><Icon name={item.icon} size={22} /></span>
				{item.label}
			</a>
		{/each}
	</nav>
{/snippet}

<!-- desktop only: the bottom nav, standing up beside the page, with Bao over its top edge -->
<aside class="mk-rail hidden lg:flex">
	<!-- one nav for every screen, so its pill can slide; on day screens Bao ducks behind it -->
	<Peek character="bao" size={56} side="right" offset={24} class={peek ? '' : 'mk-peek--away'}>{@render nav()}</Peek>
	<p class="small mt-auto px-2 text-ink-muted">Signed in as {session.me?.name}</p>
</aside>
