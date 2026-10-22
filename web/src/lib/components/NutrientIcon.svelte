<script lang="ts" module>
	import type { NutrientKey } from '../types.ts';

	/* The four tracked nutrients' symbols, drawn as Burrow stickers (filled, ink outline) on a 24 grid:
	   a flame for energy, a drumstick for protein, an ear of wheat for carbs, a drop for fat.
	   They replace letters (P, C, F) and colour dots everywhere a nutrient is named. */
	export type Nutrient = 'energy' | 'protein' | 'carbs' | 'fat';

	export const NUTRIENT_OF: Partial<Record<NutrientKey, Nutrient>> = {
		kcal: 'energy',
		protein_g: 'protein',
		carb_g: 'carbs',
		fat_g: 'fat'
	};

	const NAME: Record<Nutrient, string> = { energy: 'calories', protein: 'protein', carbs: 'carbs', fat: 'fat' };

	// cream for bone and highlights, fixed in both themes like Burrow's other cream details
	const CREAM = '#fff4e2';
	const ART: Record<Nutrient, string> = {
		energy:
			'<path paint-order="stroke" fill="var(--energy)" d="M12 2.6C12 2.6 19 8.2 19 14.2C19 18.2 15.9 21.4 12 21.4C8.1 21.4 5 18.2 5 14.2C5 10.8 7.3 8.6 7.3 8.6C7.5 10.6 8.6 11.8 9.6 12.2C9.2 8.2 12 2.6 12 2.6Z"/>' +
			'<path fill="var(--sunny)" stroke="none" d="M12 20.2C10.5 20.2 9.4 19 9.4 17.6C9.4 15.6 12 13.2 12 13.2C12 13.2 14.6 15.6 14.6 17.6C14.6 19 13.5 20.2 12 20.2Z"/>',
		protein:
			`<path paint-order="stroke" fill="${CREAM}" d="M10.78 14.78L6.18 19.38L4.62 17.82L9.22 13.22Z M7.7 19.9a1.7 1.7 0 1 0-3.4 0a1.7 1.7 0 1 0 3.4 0Z M5.8 18a1.7 1.7 0 1 0-3.4 0a1.7 1.7 0 1 0 3.4 0Z"/>` +
			'<path paint-order="stroke" fill="var(--protein)" d="M9 15C6.8 12.6 7.2 8 10.4 5.4C13.6 2.8 18.4 3 20.2 6C22 9 20.4 13.6 16.8 15.6C14.2 17 11 17 9 15Z"/>' +
			`<path fill="none" stroke="${CREAM}" stroke-width="1.3" d="M11.6 7.6C12.6 6.4 14.2 5.8 15.6 6"/>`,
		carbs:
			'<path fill="none" d="M12 21.6V8"/>' +
			'<ellipse paint-order="stroke" fill="var(--carbs)" cx="12" cy="5.6" rx="2.1" ry="3.3"/>' +
			[10.6, 15.6]
				.map(
					(y) =>
						`<ellipse paint-order="stroke" fill="var(--carbs)" cx="9.4" cy="${y}" rx="2.1" ry="3.3" transform="rotate(-38 9.4 ${y})"/>` +
						`<ellipse paint-order="stroke" fill="var(--carbs)" cx="14.6" cy="${y}" rx="2.1" ry="3.3" transform="rotate(38 14.6 ${y})"/>`
				)
				.join(''),
		fat:
			'<path paint-order="stroke" fill="var(--fat)" d="M12 2.8C12 2.8 5.2 10.4 5.2 14.6C5.2 18.4 8.2 21.4 12 21.4C15.8 21.4 18.8 18.4 18.8 14.6C18.8 10.4 12 2.8 12 2.8Z"/>' +
			`<path fill="none" stroke="${CREAM}" stroke-width="1.4" d="M8.7 14.8C8.7 16.7 9.8 18 11.3 18.4"/>`
	};
</script>

<script lang="ts">
	let {
		kind,
		size = 16,
		labelled = false,
		class: cls = ''
	}: {
		kind: Nutrient;
		/** 16 beside 14px text, 14 beside 12px labels, 18 beside 16px body text. */
		size?: number;
		/** Name it for screen readers (and a hover title) when no word next to it does. */
		labelled?: boolean;
		class?: string;
	} = $props();
</script>

<svg
	class="mk-nutrient {cls}"
	width={size}
	height={size}
	viewBox="0 0 24 24"
	stroke="var(--outline)"
	stroke-width="2.6"
	stroke-linecap="round"
	stroke-linejoin="round"
	role={labelled ? 'img' : undefined}
	aria-label={labelled ? NAME[kind] : undefined}
	aria-hidden={labelled ? undefined : 'true'}
	>{#if labelled}<title>{NAME[kind]}</title>{/if}{@html ART[kind]}</svg
>
