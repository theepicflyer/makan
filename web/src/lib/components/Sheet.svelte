<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onDestroy, tick } from 'svelte';

	let {
		open = $bindable(false),
		title = '',
		onclose,
		children,
		footer,
		tall = false
	}: {
		open?: boolean;
		title?: string;
		onclose?: () => void;
		children: Snippet;
		footer?: Snippet;
		tall?: boolean;
	} = $props();

	let panel: HTMLDivElement | undefined = $state();

	function close() {
		open = false;
		onclose?.();
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) close();
	}

	$effect(() => {
		if (open) {
			document.body.style.overflow = 'hidden';
			tick().then(() => panel?.focus());
		} else {
			document.body.style.overflow = '';
		}
	});

	onDestroy(() => {
		if (typeof document !== 'undefined') document.body.style.overflow = '';
	});
</script>

<svelte:window {onkeydown} />

{#if open}
	<div class="fixed inset-0 z-40 flex items-end justify-center sm:items-center" role="presentation">
		<button class="absolute inset-0 bg-[var(--scrim)]" aria-label="Close" tabindex="-1" onclick={close}></button>
		<div
			bind:this={panel}
			role="dialog"
			aria-modal="true"
			aria-label={title}
			tabindex="-1"
			class="relative flex w-full max-w-lg flex-col rounded-t-3xl bg-surface-2 shadow-2xl outline-none sm:rounded-3xl {tall
				? 'h-[92dvh] sm:h-[85dvh]'
				: 'max-h-[92dvh] sm:max-h-[85dvh]'}"
		>
			<div class="flex items-center gap-2 px-5 pt-3 pb-2">
				<div class="absolute top-2 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-grid sm:hidden"></div>
				<h2 class="mt-2 min-w-0 flex-1 truncate text-lg font-semibold">{title}</h2>
				<button class="mt-2 -mr-2 grid h-11 w-11 place-items-center rounded-full text-ink-2 hover:bg-wash" aria-label="Close" onclick={close}>
					<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 5l10 10M15 5L5 15" /></svg>
				</button>
			</div>
			<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4">
				{@render children()}
			</div>
			{#if footer}
				<div class="border-t border-line px-5 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
					{@render footer()}
				</div>
			{:else}
				<div class="pb-[env(safe-area-inset-bottom)]"></div>
			{/if}
		</div>
	</div>
{/if}
