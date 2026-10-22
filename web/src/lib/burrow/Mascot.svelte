<script lang="ts">
	import { mascotSVG, type Character, type Mood } from './art.js';

	let {
		character = 'bao',
		mood = 'happy',
		size = 96,
		label,
		bounce = false,
		class: cls = ''
	}: { character?: Character; mood?: Mood; size?: number; label?: string; bounce?: boolean; class?: string } = $props();
</script>

<span
	class="bh-mascot {bounce ? 'bh-mascot--bounce' : ''} {cls}"
	style="width: {size}px; height: {size}px"
	aria-hidden={label ? undefined : 'true'}>{@html mascotSVG(character, mood, label)}</span
>
