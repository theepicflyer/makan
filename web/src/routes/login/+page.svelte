<script lang="ts">
	import { goto } from '$app/navigation';
	import { get, post } from '#lib/api.ts';
	import { session, toasts } from '#lib/state.svelte.ts';
	import { onMount } from 'svelte';

	let config = $state<{ oidc: boolean; dev: boolean } | null>(null);
	let name = $state('');
	let busy = $state(false);

	onMount(async () => {
		config = await get<{ oidc: boolean; dev: boolean }>('/api/auth/config');
	});

	async function devLogin(who: string) {
		if (!who.trim()) return;
		busy = true;
		try {
			await post('/api/auth/dev-login', { name: who.trim() });
			const me = await session.load(true);
			await goto(me ? `/day/${me.today}` : '/');
		} catch (err) {
			toasts.error((err as Error).message);
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Sign in · makan</title></svelte:head>

<main class="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
	<img src="/icons/icon.svg" alt="" class="mb-6 h-16 w-16" />
	<h1 class="text-3xl font-semibold tracking-tight">makan</h1>
	<p class="mt-1 text-ink-2">Calories and macros for the two of us.</p>

	<div class="mt-10 space-y-3">
		{#if config?.oidc}
			<a href="/auth/login" data-sveltekit-reload class="btn btn-primary w-full">Sign in with Pocket ID</a>
		{/if}
		{#if config?.dev}
			<div class="card space-y-3 p-4">
				<p class="text-[13px] font-semibold text-ink-2">Development sign-in</p>
				<div class="flex gap-2">
					<button class="btn btn-ghost flex-1" disabled={busy} onclick={() => devLogin('Alice')}>Alice</button>
					<button class="btn btn-ghost flex-1" disabled={busy} onclick={() => devLogin('Bob')}>Bob</button>
				</div>
				<form
					class="flex gap-2"
					onsubmit={(e) => {
						e.preventDefault();
						devLogin(name);
					}}
				>
					<input class="field" bind:value={name} placeholder="Or any name" aria-label="Name" />
					<button class="btn btn-primary" disabled={busy || !name.trim()}>Go</button>
				</form>
			</div>
		{/if}
		{#if config && !config.oidc && !config.dev}
			<p class="text-sm text-critical-text">No sign-in method is configured on the server.</p>
		{/if}
	</div>
</main>
