<script lang="ts">
	import { page } from '$app/state';
	import Mascot from '../burrow/Mascot.svelte';
	import { toasts } from '../state.svelte.ts';

	// One at a time, the newest, just above the nav (and the composer on day screens); centred on the page beside the rail.
	const toast = $derived(toasts.items.at(-1));
	const onDay = $derived(page.url.pathname.startsWith('/day'));
	const onLogin = $derived(page.url.pathname.startsWith('/login'));
</script>

<div
	class="pointer-events-none fixed right-0 z-50 px-4"
	style="left: {onLogin ? '0px' : 'var(--rail-w)'}; bottom: calc(env(safe-area-inset-bottom) + {onLogin ? '16px' : `var(--dock-h) + ${onDay ? 'var(--composer-h) + 16px' : '16px'}`})"
	aria-live="polite"
>
	{#if toast}
		{#key toast.id}
			<div class="bh-toast pointer-events-auto mx-auto max-w-md" role="status">
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
		{/key}
	{/if}
</div>
