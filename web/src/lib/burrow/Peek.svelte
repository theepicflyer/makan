<script lang="ts">
	import type { Snippet } from 'svelte';
	import Mascot from './Mascot.svelte';
	import { ALIAS, pawsSVG, type Animal, type Character, type Mood } from './art.js';

	/* An animal behind the top edge of what it wraps, paws over the edge; or leaning around the right edge. */
	let {
		character,
		mood = 'happy',
		size = 72,
		edge = 'top',
		side = 'right',
		offset,
		class: cls = '',
		children
	}: {
		character: Character;
		mood?: Mood;
		size?: number;
		edge?: 'top' | 'side';
		side?: 'left' | 'right';
		offset?: number;
		class?: string;
		children: Snippet;
	} = $props();

	const who = $derived((ALIAS[character as keyof typeof ALIAS] ?? character) as Animal);
	const top = $derived(Math.round(size * 0.74));
	const at = $derived(offset ?? (edge === 'side' ? 12 : 24));
</script>

{#if edge === 'side'}
	<div class="bh-peek bh-peek--side {cls}" style="padding-right: {Math.round(size * 0.5)}px">
		<span class="bh-peek__animal" style="width: {size}px; height: {size}px; right: 0; top: {at}px"><Mascot character={who} {mood} {size} /></span>
		<div class="bh-peek__body">{@render children()}</div>
		<span class="bh-peek__paws" style="right: {Math.round(size * 0.5) - Math.round(size * 0.1)}px; top: {at + Math.round(size * 0.6)}px"
			>{@html pawsSVG(who, 1, size)}</span
		>
	</div>
{:else}
	<div class="bh-peek {cls}" style="padding-top: {top}px">
		<span class="bh-peek__animal" style="width: {size}px; height: {size}px; {side}: {at}px"><Mascot character={who} {mood} {size} /></span>
		<div class="bh-peek__body">{@render children()}</div>
		<span class="bh-peek__paws" style="top: {top - Math.round(size * 0.06)}px; {side}: {at + size * 0.25}px">{@html pawsSVG(who, 2, size)}</span>
	</div>
{/if}
