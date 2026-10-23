import type { Turn } from './types.ts';

export type AgentEvent =
	| { type: 'turn'; turn_id: number }
	| { type: 'text'; delta: string }
	| { type: 'tool'; name: string }
	| { type: 'changed'; dates: string[] }
	| { type: 'done'; turn: Turn; dates: string[] }
	| { type: 'error'; message: string };

export const TOOL_LABEL: Record<string, string> = {
	search_foods: 'Searching foods',
	get_entries: 'Reading your log',
	log_entries: 'Logging',
	update_entries: 'Updating entries',
	delete_entries: 'Removing entries',
	save_food: 'Saving food',
	delete_food: 'Deleting food'
};

/** POST a message to the assistant and yield its server-sent events. */
export async function* sendTurn(date: string, text: string, photos: Blob[]): AsyncGenerator<AgentEvent> {
	const form = new FormData();
	form.set('date', date);
	form.set('text', text);
	for (const photo of photos) form.append('photos', photo, 'photo.jpg');
	const res = await fetch('/api/agent/turns', {
		method: 'POST',
		body: form,
		headers: { 'X-Makan': '1' },
		credentials: 'same-origin'
	});
	if (!res.ok || !res.body) {
		let message = `${res.status} ${res.statusText}`;
		try {
			const body = await res.json();
			if (typeof body.detail === 'string') message = body.detail;
		} catch {
			/* not JSON */
		}
		yield { type: 'error', message };
		return;
	}
	const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
	let buffer = '';
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		buffer += value;
		let idx;
		while ((idx = buffer.indexOf('\n\n')) >= 0) {
			const chunk = buffer.slice(0, idx);
			buffer = buffer.slice(idx + 2);
			const data = chunk
				.split('\n')
				.filter((l) => l.startsWith('data:'))
				.map((l) => l.slice(5).trimStart())
				.join('\n');
			if (!data) continue;
			try {
				yield JSON.parse(data) as AgentEvent;
			} catch {
				/* ignore malformed event */
			}
		}
	}
}
