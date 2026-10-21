<script lang="ts">
	import { page } from '$app/state';
	import { session } from '../state.svelte.ts';

	const path = $derived(page.url.pathname);
	const items = $derived([
		{ href: session.me ? `/day/${session.me.today}` : '/', label: 'Today', match: (p: string) => p === '/' || p.startsWith('/day'), icon: 'today' },
		{ href: '/foods', label: 'Foods', match: (p: string) => p.startsWith('/foods'), icon: 'foods' },
		{ href: '/history', label: 'History', match: (p: string) => p.startsWith('/history'), icon: 'history' },
		{ href: '/settings', label: 'Settings', match: (p: string) => p.startsWith('/settings'), icon: 'settings' }
	]);
</script>

<nav
	class="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
	aria-label="Main"
>
	<ul class="mx-auto grid max-w-lg grid-cols-4">
		{#each items as item (item.label)}
			{@const active = item.match(path)}
			<li>
				<a
					href={item.href}
					class="flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium {active ? 'text-ink' : 'text-muted'}"
					aria-current={active ? 'page' : undefined}
				>
					<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={active ? 2.2 : 1.8} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						{#if item.icon === 'today'}
							<path d="M4 11h16M5 11c0 4.4 3.1 8 7 8s7-3.6 7-8" /><path d="M9 21h6" /><path d="M10 7.5c.5-1.5 2-2 2-3.5M14 7.5c.5-1.5 2-2 2-3.5" />
						{:else if item.icon === 'foods'}
							<path d="M4 6h16M4 12h16M4 18h10" />
						{:else if item.icon === 'history'}
							<path d="M5 20V12M10 20V6M15 20v-9M20 20V9" />
						{:else}
							<circle cx="12" cy="12" r="3" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" />
						{/if}
					</svg>
					{item.label}
				</a>
			</li>
		{/each}
	</ul>
</nav>
