<script lang="ts">
	import type { Source } from '../types.ts';
	let { source }: { source: Source } = $props();
	const label = $derived(source === 'ours' ? 'Ours' : source === 'sgfoodid' ? 'SG' : 'USDA');
</script>

<span
	class="inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-[11px] font-semibold tracking-wide {source === 'ours'
		? 'bg-ink text-surface'
		: 'bg-wash text-ink-2'}"
	title={source === 'sgfoodid' ? 'SG FoodID (Health Promotion Board)' : source === 'usda' ? 'USDA FoodData Central' : 'Household food'}
	>{label}</span
>
