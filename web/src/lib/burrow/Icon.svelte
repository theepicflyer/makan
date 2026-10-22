<script lang="ts" module>
	import { ICONS } from './art.js';

	/* Burrow's icon set plus the few makan needs, drawn the same way: round caps, 2.2 stroke, 24 grid. */
	const EXTRA = {
		'chevron-left': 'M15 5 L8 12 L15 19',
		'chevron-right': 'M9 5 L16 12 L9 19',
		close: 'M6 6 L18 18 M18 6 L6 18',
		minus: 'M5 12 H19',
		chat: 'M4 5 H20 V16 H10 L5 20 V16 H4 Z',
		bookmark: 'M7 4 H17 V20 L12 16 L7 20 Z',
		pin: 'M9 4 H15 L14 10 L17 13.5 H7 L10 10 Z M12 13.5 V20',
		star: 'M12 3.5 L14.6 8.8 L20.5 9.7 L16.2 13.8 L17.2 19.6 L12 16.9 L6.8 19.6 L7.8 13.8 L3.5 9.7 L9.4 8.8 Z',
		trash: 'M5 7 H19 M10 4 H14 M7 7 L8 20 H16 L17 7',
		'sign-out': 'M14 4 H19 V20 H14 M10 8 L6 12 L10 16 M6 12 H15',
		bell: 'M6 16.5 V11 A6 6 0 0 1 18 11 V16.5 L19.5 18.5 H4.5 Z M10 21 H14'
	};
	const PATHS: Record<string, string> = { ...ICONS, ...EXTRA };
	export type IconName = keyof typeof ICONS | keyof typeof EXTRA;
</script>

<script lang="ts">
	let {
		name,
		size = 24,
		label,
		filled = false,
		class: cls = ''
	}: { name: IconName; size?: number; label?: string; filled?: boolean; class?: string } = $props();
</script>

<svg
	class="bh-icon {cls}"
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill={filled ? 'currentColor' : 'none'}
	stroke="currentColor"
	stroke-width="2.2"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden={label ? undefined : 'true'}
	aria-label={label}
	role={label ? 'img' : undefined}><path d={PATHS[name] ?? PATHS.plus} /></svg
>
