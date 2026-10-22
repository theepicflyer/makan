<script lang="ts">
	import '@fontsource/fredoka/latin-600.css';
	import '@fontsource/figtree/latin-400.css';
	import '@fontsource/figtree/latin-600.css';
	import './layout.css';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import BottomNav from '#lib/components/BottomNav.svelte';
	import SideNav from '#lib/components/SideNav.svelte';
	import Toasts from '#lib/components/Toasts.svelte';
	import Loader from '#lib/burrow/Loader.svelte';
	import { session } from '#lib/state.svelte.ts';
	import { onMount } from 'svelte';

	let { children } = $props();
	let ready = $state(false);
	const isLogin = $derived(page.url.pathname.startsWith('/login'));

	onMount(async () => {
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
		     desktop: a wider column beside the rail -->
		<div class="mx-auto min-h-dvh w-full max-w-lg min-w-0 pb-[calc(env(safe-area-inset-bottom)+var(--dock-h)+64px)] lg:max-w-6xl lg:px-8 lg:pt-6">
			{@render children()}
		</div>
	</div>
	<BottomNav />
{:else}
	<div class="grid min-h-dvh place-items-center">
		<Loader kind="crumbs" />
	</div>
{/if}
