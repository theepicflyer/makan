import { flip as baseFlip, type AnimationConfig, type FlipParams } from 'svelte/animate';
import { backOut, cubicIn, cubicOut } from 'svelte/easing';
import { prefersReducedMotion } from 'svelte/motion';
import * as t from 'svelte/transition';

/* makan's motion. Things on screen when a page opens come in with CSS (the motion section of layout.css);
   these Svelte transitions play when something is added, removed or swapped afterwards. Each one stands
   still when the device asks for reduced motion, which Svelte's own don't. */

const still = { duration: 0 };

/** Burrow's springy curve, cubic-bezier(.34, 1.56, .64, 1): a little past the mark and back. */
export const spring = backOut;

export const fade: typeof t.fade = (node, params) => (prefersReducedMotion.current ? still : t.fade(node, params));

export const fly: typeof t.fly = (node, params) => (prefersReducedMotion.current ? still : t.fly(node, { easing: cubicOut, ...params }));

export const scale: typeof t.scale = (node, params) => (prefersReducedMotion.current ? still : t.scale(node, { easing: cubicOut, ...params }));

/** A sheet rising from the bottom edge, springing as it lands; it drops away faster than it came. */
export function sheet(node: Element, _params: unknown, { direction }: { direction: 'in' | 'out' | 'both' }) {
	if (prefersReducedMotion.current) return still;
	return direction === 'out'
		? t.fly(node, { y: 72, duration: 200, easing: cubicIn })
		: t.fly(node, { y: 72, duration: 420, easing: spring, opacity: 0.4 });
}

export function flip(node: Element, fromTo: { from: DOMRect; to: DOMRect }, params?: FlipParams): AnimationConfig {
	return prefersReducedMotion.current ? still : baseFlip(node, fromTo, { duration: 260, ...params });
}

/** An attachment for a nav: the current item's pill becomes one blob that slides from item to item.
    The nav marks its current item with aria-current and each item has a .bh-nav__pill. */
export function slidingPill(nav: HTMLElement) {
	const blob = document.createElement('span');
	blob.className = 'mk-pill-blob';
	nav.prepend(blob);
	nav.classList.add('has-blob');

	const place = () => {
		const pill = nav.querySelector<HTMLElement>('[aria-current="page"] .bh-nav__pill');
		const item = pill?.parentElement;
		blob.hidden = !pill || !item;
		if (!pill || !item) return;
		// offsets rather than client rects, so a transform on the way in doesn't throw it off
		blob.style.translate = `${item.offsetLeft + pill.offsetLeft}px ${item.offsetTop + pill.offsetTop}px`;
		blob.style.width = `${pill.offsetWidth}px`;
		blob.style.height = `${pill.offsetHeight}px`;
	};
	place();
	const moved = new MutationObserver(place);
	moved.observe(nav, { subtree: true, attributeFilter: ['aria-current'] });
	const resized = new ResizeObserver(place);
	resized.observe(nav);

	return () => {
		moved.disconnect();
		resized.disconnect();
		blob.remove();
		nav.classList.remove('has-blob');
	};
}
