<script lang="ts">
	import NutrientIcon from './NutrientIcon.svelte';
	import { grams } from '../format.ts';

	/* Protein, carbs and fat in a row, each after its symbol: for list rows with no room for the words. */
	let {
		protein,
		carbs,
		fat,
		unit = ''
	}: { protein: number | null | undefined; carbs: number | null | undefined; fat: number | null | undefined; unit?: string } = $props();
</script>

<span class="mk-macros bh-num">
	<span><NutrientIcon kind="protein" size={14} labelled />{grams(protein)}{unit}</span>
	<span><NutrientIcon kind="carbs" size={14} labelled />{grams(carbs)}{unit}</span>
	<span><NutrientIcon kind="fat" size={14} labelled />{grams(fat)}{unit}</span>
</span>
