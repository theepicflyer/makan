<script lang="ts">
	import { page } from '$app/state';
	import Icon, { type IconName } from '../burrow/Icon.svelte';
	import Peek from '../burrow/Peek.svelte';
	import { session } from '../state.svelte.ts';

	const path = $derived(page.url.pathname);
	// Day screens put Bao over the composer instead, so there is one peek per screen.
	const peek = $derived(!path.startsWith('/day'));
	const items: { href: () => string; label: string; match: (p: string) => boolean; icon: IconName }[] = [
		{ href: () => (session.me ? `/day/${session.me.today}` : '/'), label: 'Today', match: (p) => p === '/' || p.startsWith('/day'), icon: 'home' },
		{ href: () => '/foods', label: 'Foods', match: (p) => p.startsWith('/foods'), icon: 'bowl' },
		{ href: () => '/history', label: 'History', match: (p) => p.startsWith('/history'), icon: 'calendar' },
		{ href: () => '/settings', label: 'Settings', match: (p) => p.startsWith('/settings'), icon: 'gear' }
	];
</script>

{#snippet nav()}
	<nav class="bh-nav" aria-label="Main">
		{#each items as item (item.label)}
			{@const active = item.match(path)}
			<a href={item.href()} class="bh-nav__item {active ? 'is-active' : ''}" aria-current={active ? 'page' : undefined}>
				<span class="bh-nav__pill"><Icon name={item.icon} size={22} /></span>
				<span class="bh-nav__label">{item.label}</span>
			</a>
		{/each}
	</nav>
{/snippet}

<div class="mk-dock pointer-events-none fixed inset-x-0 bottom-0 z-30 px-4" style="padding-bottom: calc(env(safe-area-inset-bottom) + var(--nav-gap))">
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
