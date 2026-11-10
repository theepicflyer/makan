<script lang="ts">
	/* A thumb up or down, drawn like Burrow's icons (24 grid, 2.2 stroke, round caps), for rating Bao's replies. */
	let { down = false, size = 20, filled = false }: { down?: boolean; size?: number; filled?: boolean } = $props();
</script>

<svg
	class="bh-icon"
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill={filled ? 'currentColor' : 'none'}
	stroke="currentColor"
	stroke-width="2.2"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	style={down ? 'transform: scaleY(-1)' : undefined}
	><path
		d="M7.5 10.5 V20 H4 V10.5 Z M7.5 10.5 L11 3.5 C12.6 3.5 13.6 4.6 13.2 6.2 L12.5 9.5 H18.4 C19.6 9.5 20.4 10.6 20.1 11.7 L18.4 18.4 C18.1 19.4 17.3 20 16.3 20 H7.5"
	/></svg
>
