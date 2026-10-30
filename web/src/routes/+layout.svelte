<script lang="ts">
	import '@fontsource/fredoka/latin-600.css';
	import '@fontsource/figtree/latin-400.css';
	import '@fontsource/figtree/latin-600.css';
	import './layout.css';
	import { page } from '$app/state';
	import { goto, onNavigate } from '$app/navigation';
	import BottomNav from '#lib/components/BottomNav.svelte';
	import SideNav from '#lib/components/SideNav.svelte';
	import Toasts from '#lib/components/Toasts.svelte';
	import Loader from '#lib/burrow/Loader.svelte';
	import { session } from '#lib/state.svelte.ts';
	import { onMount } from 'svelte';

	let { children } = $props();
	let ready = $state(false);
	const isLogin = $derived(page.url.pathname.startsWith('/login'));

	// Screens cross over with a view transition (layout.css says how). One day to another is the same
	// screen, so it skips this and the day slides over by itself.
	onNavigate((navigation) => {
		if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		if (navigation.from?.route.id === navigation.to?.route.id) return;
		return new Promise((resolve) => {
			document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
			});
		});
	});

	onMount(async () => {
		// a tapped reminder asks the open app to show its day (see the service worker)
		navigator.serviceWorker?.addEventListener('message', (event) => {
			if (event.data?.type === 'open' && typeof event.data.url === 'string') goto(event.data.url);
		});
		if (isLogin) {
			ready = true;
			return;
		}
		const me = await session.load();
		if (!me) {
			await goto('/login', { replace: true });
		}
		ready = true;
	});
</script>

<Toasts />

{#if isLogin}
	{@render children()}
{:else if ready && session.me}
	<div class="lg:flex">
		<SideNav />
		<!-- phones: one column with room underneath for the floating nav and Bao peeking over it;
		     unfolded foldables and tablets: the full width, for the screens' columns; desktop: a wider column beside the rail -->
		<div class="mx-auto min-h-dvh w-full max-w-lg min-w-0 pb-[calc(env(safe-area-inset-bottom)+var(--dock-h)+64px)] sm:max-w-none lg:max-w-6xl lg:px-8 lg:pt-6">
			{@render children()}
		</div>
	</div>
	<BottomNav />
{:else}
	<div class="grid min-h-dvh place-items-center">
		<Loader kind="crumbs" />
	</div>
{/if}
