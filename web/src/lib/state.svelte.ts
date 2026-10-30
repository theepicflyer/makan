import { MediaQuery } from 'svelte/reactivity';
import { get } from './api.ts';
import type { Me } from './types.ts';
import type { Character, Mood } from './burrow/art.js';

class Session {
	me = $state<Me | null>(null);
	loading = $state(false);

	async load(force = false): Promise<Me | null> {
		if (this.me && !force) return this.me;
		this.loading = true;
		try {
			this.me = await get<Me>('/api/me');
		} catch {
			this.me = null;
		} finally {
			this.loading = false;
		}
		return this.me;
	}
}

export const session = new Session();

/** Wide enough for screens to lay out in columns (Tailwind's sm): unfolded foldables, tablets and desktops. */
export const columns = new MediaQuery('min-width: 640px', false);

/** Desktop and laptop widths, where the side rail replaces the bottom nav and Today's composer moves into its left column (Tailwind's lg). */
export const wide = new MediaQuery('min-width: 1024px', false);

/** A half-folded screen in book posture: two viewport segments side by side (Tailwind's `book:`). */
export const book = new MediaQuery('horizontal-viewport-segments: 2', false);

export interface Toast {
	id: number;
	message: string;
	action?: { label: string; run: () => void | Promise<void> };
	tone?: 'info' | 'error';
	/** The animal in the toast, by job: Bao for food (the default), Kayu for settings, saving and errors. */
	character?: Character;
	mood?: Mood;
}

class Toasts {
	items = $state<Toast[]>([]);
	#next = 1;

	show(message: string, opts: Omit<Toast, 'id' | 'message'> = {}, ms = opts.action ? 8000 : 4000) {
		const id = this.#next++;
		this.items = [...this.items, { id, message, ...opts }];
		setTimeout(() => this.dismiss(id), ms);
		return id;
	}

	error(message: string) {
		return this.show(message, { tone: 'error', character: 'kayu', mood: 'worried' }, 6000);
	}

	dismiss(id: number) {
		this.items = this.items.filter((t) => t.id !== id);
	}
}

export const toasts = new Toasts();

/** Bumped whenever log data changes, so open views can refetch. */
class Revision {
	value = $state(0);
	bump() {
		this.value++;
	}
}

export const revision = new Revision();
