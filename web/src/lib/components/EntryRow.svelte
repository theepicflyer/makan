<script lang="ts">
	import type { Entry } from '../types.ts';
	import { entryPortion, grams, kcal } from '../format.ts';

	let { entry, onclick }: { entry: Entry; onclick: () => void } = $props();
</script>

<button class="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-wash active:bg-wash" {onclick}>
	{#if entry.photo_id}
		<img
			src="/api/photos/{entry.photo_id}"
			alt=""
			loading="lazy"
			class="h-10 w-10 shrink-0 rounded-lg object-cover"
		/>
	{/if}
	<div class="min-w-0 flex-1">
		<div class="flex items-center gap-1.5">
			<span class="truncate text-[15px] font-medium">{entry.name}</span>
			{#if entry.is_estimate}
				<span class="shrink-0 rounded bg-wash px-1 text-[11px] font-semibold text-ink-2" title="Estimated">est.</span>
			{/if}
		</div>
		<div class="truncate text-[13px] text-muted">
			{entryPortion(entry.servings, entry.serving_label, entry.grams) || '—'} · P {grams(entry.protein_g)} · C {grams(entry.carb_g)} · F {grams(entry.fat_g)}
		</div>
	</div>
	<div class="shrink-0 text-right text-[15px] font-semibold tabular">{kcal(entry.kcal)}</div>
</button>
