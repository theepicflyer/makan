<script lang="ts">
	import { goto } from '$app/navigation';
	import { session } from '#lib/state.svelte.ts';
	import { onMount } from 'svelte';

	onMount(async () => {
		const me = await session.load();
		if (me) await goto(`/day/${me.today}`, { replace: true });
	});
</script>
