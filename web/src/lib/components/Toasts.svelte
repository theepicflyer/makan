<script lang="ts">
	import { toasts } from '../state.svelte.ts';
</script>

<div
	class="pointer-events-none fixed inset-x-0 top-0 z-50 flex flex-col items-center gap-2 px-4 pt-[max(12px,env(safe-area-inset-top))]"
	aria-live="polite"
>
	{#each toasts.items as t (t.id)}
		<div
			class="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl px-4 py-2.5 text-sm shadow-lg {t.tone === 'error'
				? 'bg-critical text-white'
				: 'bg-ink text-surface'}"
			role="status"
		>
			<span class="min-w-0 flex-1">{t.message}</span>
			{#if t.action}
				<button
					class="-my-1 min-h-9 rounded-full px-3 font-semibold underline-offset-2 hover:underline"
					onclick={async () => {
						const action = t.action;
						toasts.dismiss(t.id);
						await action?.run();
					}}>{t.action.label}</button
				>
			{/if}
		</div>
	{/each}
</div>
