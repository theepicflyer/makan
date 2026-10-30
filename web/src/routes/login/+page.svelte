<script lang="ts">
	import { goto } from '$app/navigation';
	import Field from '#lib/burrow/Field.svelte';
	import World from '#lib/burrow/World.svelte';
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

<main class="mk-stagger mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 pt-[env(safe-area-inset-top)] pb-[max(24px,env(safe-area-inset-bottom))]">
	<!-- the whole household: Kacang's oak, Gali's burrow, Bao's sunflowers, Kayu's river -->
	<World />
	<h1 class="mt-6 font-[family-name:var(--font-display)] text-[40px] leading-[44px] font-semibold">makan</h1>
	<p class="body mt-1 text-ink-muted">Calories and macros for the two of us.</p>

	<div class="mt-8 space-y-3">
		{#if config?.oidc}
			<a href="/auth/login" data-sveltekit-reload class="bh-btn bh-btn--primary w-full">Sign in with Pocket ID</a>
		{/if}
		{#if config?.dev}
			<div class="bh-card space-y-3">
				<p class="label text-ink-muted">Development sign-in</p>
				<div class="flex gap-2">
					<button class="bh-btn bh-btn--secondary flex-1" disabled={busy} onclick={() => devLogin('Alice')}>Alice</button>
					<button class="bh-btn bh-btn--secondary flex-1" disabled={busy} onclick={() => devLogin('Bob')}>Bob</button>
				</div>
				<form
					class="flex items-end gap-2"
					onsubmit={(e) => {
						e.preventDefault();
						devLogin(name);
					}}
				>
					<Field label="Or any name" class="min-w-0 flex-1" bind:value={name} placeholder="e.g. Sam" />
					<button class="bh-btn bh-btn--primary" disabled={busy || !name.trim()}>Go</button>
				</form>
			</div>
		{/if}
		{#if config && !config.oidc && !config.dev}
			<p class="small font-semibold text-tomato-text">No sign-in method is configured on the server.</p>
		{/if}
	</div>
</main>
