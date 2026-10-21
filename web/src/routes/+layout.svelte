<script lang="ts">
	import './layout.css';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import BottomNav from '#lib/components/BottomNav.svelte';
	import Toasts from '#lib/components/Toasts.svelte';
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
	<div class="mx-auto min-h-dvh max-w-lg px-4 pt-[max(12px,env(safe-area-inset-top))] pb-[calc(56px+env(safe-area-inset-bottom)+24px)]">
		{@render children()}
	</div>
	<BottomNav />
{:else}
	<div class="grid min-h-dvh place-items-center text-muted">
		<span class="h-6 w-6 animate-spin rounded-full border-2 border-grid border-t-ink" aria-label="Loading"></span>
	</div>
{/if}
