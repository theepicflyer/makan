<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onDestroy, tick } from 'svelte';
	import Icon from '../burrow/Icon.svelte';
	import { fade, sheet } from '../motion.ts';

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
		<button class="mk-scrim absolute inset-0" aria-label="Close" tabindex="-1" onclick={close} transition:fade={{ duration: 200 }}></button>
		<div
			bind:this={panel}
			role="dialog"
			aria-modal="true"
			aria-label={title}
			tabindex="-1"
			transition:sheet
			class="mk-sheet relative flex w-full max-w-lg flex-col outline-none {tall ? 'h-[92dvh] sm:h-[85dvh]' : 'max-h-[92dvh] sm:max-h-[85dvh]'}"
		>
			<div class="mk-handle absolute top-2 left-1/2 -translate-x-1/2 sm:hidden"></div>
			<div class="flex items-center gap-2 px-5 pt-5 pb-3">
				<h2 class="card-title min-w-0 flex-1 truncate">{title}</h2>
				<button class="bh-btn bh-btn--ghost bh-btn--sm bh-btn--icon -mr-2" aria-label="Close" onclick={close}>
					<Icon name="close" size={20} />
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
