<script lang="ts">
	import type { Source } from '../types.ts';
	let { source }: { source: Source } = $props();
	const label = $derived(source === 'ours' ? 'Ours' : source === 'sgfoodid' ? 'SG' : 'USDA');
</script>

<span
	class="mk-badge {source === 'ours' ? 'mk-badge--ours' : ''}"
	title={source === 'sgfoodid' ? 'SG FoodID (Health Promotion Board)' : source === 'usda' ? 'USDA FoodData Central' : 'Household food'}
	>{label}</span
>
