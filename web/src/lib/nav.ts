import type { IconName } from './burrow/Icon.svelte';
import { session } from './state.svelte.ts';

/** The main screens, shared by the bottom nav on phones and the side rail on desktop. */
export const NAV_ITEMS: { href: () => string; label: string; match: (p: string) => boolean; icon: IconName }[] = [
	{ href: () => (session.me ? `/day/${session.me.today}` : '/'), label: 'Today', match: (p) => p === '/' || p.startsWith('/day'), icon: 'home' },
	{ href: () => '/foods', label: 'Foods', match: (p) => p.startsWith('/foods'), icon: 'bowl' },
	{ href: () => '/history', label: 'History', match: (p) => p.startsWith('/history'), icon: 'calendar' },
	{ href: () => '/settings', label: 'Settings', match: (p) => p.startsWith('/settings'), icon: 'gear' }
];

/** Day screens put Bao over the composer instead, so there is one peek per screen. */
export function navPeek(path: string): boolean {
	return !path.startsWith('/day');
}
