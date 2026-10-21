import { immutable, assets } from '$app/manifest';
import { version } from '$app/env';

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `makan-${version}`;
// The backend serves the app shell at / (it has no /index.html route).
const SHELL = '/';
const PRECACHE = [...immutable.map((f) => f.path), ...assets.map((f) => f.path), SHELL].map((p) =>
	p.startsWith('/') ? p : `/${p}`
);
const NEVER = ['/api/', '/auth/', '/mcp', '/authorize', '/token', '/register', '/.well-known/'];

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(PRECACHE))
			.then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => sw.clients.claim())
	);
});

sw.addEventListener('fetch', (event) => {
	const req = event.request;
	if (req.method !== 'GET') return;
	const url = new URL(req.url);
	if (url.origin !== sw.location.origin) return;
	if (NEVER.some((p) => url.pathname.startsWith(p))) return;

	if (req.mode === 'navigate') {
		// Network first so a deploy shows up at once; the cached shell covers offline.
		event.respondWith(
			fetch(req).catch(async () => (await caches.match(SHELL)) ?? Response.error())
		);
		return;
	}

	if (PRECACHE.includes(url.pathname)) {
		event.respondWith(caches.match(req).then((hit) => hit ?? fetch(req)));
	}
});
