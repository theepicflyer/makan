<script lang="ts">
	import type { Snippet } from 'svelte';
	import Mascot from './Mascot.svelte';
	import { ALIAS, HAB, cloud, type Character, type HabitatKind, type Mood } from './art.js';

	let {
		kind,
		character,
		mood = 'happy',
		size = 96,
		bounce = false,
		class: cls = '',
		children
	}: {
		kind: HabitatKind;
		character?: Character | false;
		mood?: Mood;
		size?: number;
		bounce?: boolean;
		class?: string;
		children?: Snippet;
	} = $props();

	const hab = $derived(HAB[kind] ?? HAB.meadow);
	const who = $derived(character === false ? null : character ? (ALIAS[character as keyof typeof ALIAS] ?? character) : hab.who);
	const scene = $derived(hab.props());
</script>

<div class="bh-habitat bh-habitat--{kind} {cls}">
	{#if hab.far}
		<span class="bh-habitat__far"
			>{@html `<svg viewBox="0 0 400 60" preserveAspectRatio="none" width="100%" height="60" aria-hidden="true">${hab.far}</svg>`}</span
		>
	{/if}
	{#if kind !== 'burrow'}
		<span class="bh-habitat__clouds"
			>{@html `<svg viewBox="0 0 160 40" width="160" height="40" aria-hidden="true">${cloud(4, 8, 0.9) + cloud(92, 2, 0.7)}</svg>`}</span
		>
	{/if}
	<span class="bh-habitat__props">{@html `<svg viewBox="0 0 210 150" width="210" height="150" aria-hidden="true">${scene}</svg>`}</span>
	<span class="bh-habitat__ground"
		>{@html `<svg viewBox="0 0 400 48" preserveAspectRatio="none" width="100%" height="48" aria-hidden="true">${hab.ground}</svg>`}</span
	>
	{#if who}
		<span class="bh-habitat__resident"><Mascot character={who} {mood} {size} {bounce} /></span>
	{/if}
	<div class="bh-habitat__content">{@render children?.()}</div>
</div>
