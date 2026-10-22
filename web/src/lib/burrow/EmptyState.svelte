<script lang="ts">
	import type { Snippet } from 'svelte';
	import Mascot from './Mascot.svelte';
	import Trace from './Trace.svelte';
	import type { Character, Mood, TraceName } from './art.js';

	/* An animal (or, on a screen that already has its animal, a trace), a title, one line and one action. */
	let {
		character = 'bao',
		mood = 'sleepy',
		trace,
		size = 112,
		title,
		body,
		action
	}: {
		character?: Character;
		mood?: Mood;
		trace?: TraceName;
		size?: number;
		title: string;
		body?: string;
		action?: Snippet;
	} = $props();
</script>

<div class="bh-empty">
	{#if trace}<Trace name={trace} size={48} />{:else}<Mascot {character} {mood} {size} />{/if}
	<h3 class="bh-empty__title">{title}</h3>
	{#if body}<p class="bh-empty__body">{body}</p>{/if}
	{@render action?.()}
</div>
