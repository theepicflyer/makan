import { goto } from '$app/navigation';

export class ApiError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message);
	}
}

async function errorMessage(res: Response): Promise<string> {
	try {
		const body = await res.json();
		if (typeof body.detail === 'string') return body.detail;
		if (Array.isArray(body.detail)) return body.detail.map((d: { msg: string }) => d.msg).join('; ');
	} catch {
		/* not JSON */
	}
	return `${res.status} ${res.statusText}`;
}

/** Fetch against the makan API. Every call carries X-Makan, which the backend requires on writes. */
export async function raw(path: string, init: RequestInit = {}): Promise<Response> {
	const headers = new Headers(init.headers);
	headers.set('X-Makan', '1');
	const res = await fetch(path, { ...init, headers, credentials: 'same-origin' });
	if (res.status === 401 && !location.pathname.startsWith('/login')) {
		await goto('/login');
		throw new ApiError(401, 'Not signed in');
	}
	if (!res.ok) throw new ApiError(res.status, await errorMessage(res));
	return res;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
	const res = await raw(path, init);
	return (await res.json()) as T;
}

export function get<T>(path: string): Promise<T> {
	return api<T>(path);
}

function withBody(method: string, body: unknown): RequestInit {
	return {
		method,
		headers: { 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	};
}

export const post = <T>(path: string, body?: unknown) => api<T>(path, withBody('POST', body ?? {}));
export const patch = <T>(path: string, body: unknown) => api<T>(path, withBody('PATCH', body));
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });
