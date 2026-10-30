<script lang="ts">
	import { Tween, prefersReducedMotion } from 'svelte/motion';
	import { cubicOut } from 'svelte/easing';

	/* A number that counts to its value: up from zero when it first shows, then from the old value to each new one. */
	let { value, format = (n: number) => `${Math.round(n)}` }: { value: number | null | undefined; format?: (n: number) => string } = $props();

	const shown = new Tween(0, { easing: cubicOut });

	$effect(() => {
		if (value != null) shown.set(value, { duration: prefersReducedMotion.current ? 0 : 700 });
	});
</script>

{value == null ? '–' : format(shown.current)}
