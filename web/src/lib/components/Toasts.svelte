<script lang="ts">
	import { page } from '$app/state';
	import Mascot from '../burrow/Mascot.svelte';
	import { toasts } from '../state.svelte.ts';
	import { fly } from '../motion.ts';

	// One at a time, the newest, just above the nav (and the composer on day screens); centred on the page beside the rail.
	// A list of one so the old toast drops away (in the same grid cell) as the next pops in.
	const shown = $derived(toasts.items.slice(-1));
	const onDay = $derived(page.url.pathname.startsWith('/day'));
	const onLogin = $derived(page.url.pathname.startsWith('/login'));
</script>

<div
	class="pointer-events-none fixed z-50 grid px-4"
	style="left: {onLogin ? '0px' : 'var(--rail-w)'}; right: var(--fold-right); bottom: calc(env(safe-area-inset-bottom) + {onLogin ? '16px' : `var(--dock-h) + ${onDay ? 'var(--composer-h) + 16px' : '16px'}`})"
	aria-live="polite"
>
	{#each shown as toast (toast.id)}
		<div class="bh-toast pointer-events-auto col-start-1 row-start-1 mx-auto w-full max-w-md" role="status" out:fly={{ y: 16, duration: 200 }}>
			<span class="bh-toast__bub">
				<Mascot character={toast.character ?? 'bao'} mood={toast.mood ?? (toast.action ? 'happy' : 'joy')} size={40} />
			</span>
			<span class="bh-toast__text">{toast.message}</span>
			{#if toast.action}
				<button
					class="bh-btn bh-btn--ghost"
					onclick={async () => {
						const action = toast.action;
						toasts.dismiss(toast.id);
						await action?.run();
					}}>{toast.action.label}</button
				>
			{/if}
		</div>
	{/each}
</div>
