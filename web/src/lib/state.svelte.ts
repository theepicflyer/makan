import { get } from './api.ts';
import type { Me } from './types.ts';

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

export interface Toast {
	id: number;
	message: string;
	action?: { label: string; run: () => void | Promise<void> };
	tone?: 'info' | 'error';
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
		return this.show(message, { tone: 'error' }, 6000);
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
