<script lang="ts">
	import { traceSVG, type TraceName } from './art.js';

	let {
		name,
		size = 32,
		class: cls = '',
		style = ''
	}: { name: TraceName; size?: number; class?: string; style?: string } = $props();
</script>

<span class="bh-trace {cls}" style="width: {size}px; height: {size}px; {style}" aria-hidden="true">{@html traceSVG(name, size)}</span>
