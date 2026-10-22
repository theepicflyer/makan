import { get, post } from './api.ts';

/* Daily reminders on this device: a Web Push subscription the server sends to at the user's reminder time
   (src/makan/reminders.py). The service worker shows them and opens the day when one is tapped. */

/** What this browser can do: subscribe, needs installing first (iPhone and iPad), or nothing. */
export type PushSupport = 'ready' | 'install' | 'unsupported';

export function pushSupport(): PushSupport {
	if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) return 'ready';
	// iOS only offers push to web apps opened from the Home Screen
	const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
	return ios && !matchMedia('(display-mode: standalone)').matches ? 'install' : 'unsupported';
}

async function registration(): Promise<ServiceWorkerRegistration> {
	return navigator.serviceWorker.ready;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
	return (await registration()).pushManager.getSubscription();
}

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
	const bin = atob(b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64url.length % 4)) % 4));
	const out = new Uint8Array(new ArrayBuffer(bin.length));
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

function madeWith(sub: PushSubscription, key: Uint8Array): boolean {
	const k = sub.options.applicationServerKey;
	if (!k) return false;
	const a = new Uint8Array(k);
	return a.length === key.length && a.every((v, i) => v === key[i]);
}

/** Subscribe (or keep the subscription there is) with the server's key, and hand it to the server. */
async function subscribe(): Promise<PushSubscription> {
	const { key } = await get<{ key: string }>('/api/push/key');
	const bytes = keyBytes(key);
	const reg = await registration();
	let sub = await reg.pushManager.getSubscription();
	// one made with an older server key would be refused by the push service
	if (sub && !madeWith(sub, bytes)) {
		await sub.unsubscribe();
		sub = null;
	}
	sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
	await post('/api/push/subscriptions', sub.toJSON());
	return sub;
}

/** Turn reminders on for this device. Call it from a tap: browsers only ask for permission then. */
export async function turnOn(): Promise<PushSubscription | null> {
	if ((await Notification.requestPermission()) !== 'granted') return null;
	return subscribe();
}

/** When Settings opens: re-register this device's subscription, in case the server lost or moved it. */
export async function refresh(): Promise<PushSubscription | null> {
	if (pushSupport() !== 'ready' || Notification.permission !== 'granted') return null;
	if (!(await currentSubscription())) return null;
	return subscribe();
}

export async function turnOff(): Promise<void> {
	const sub = await currentSubscription();
	if (!sub) return;
	await post('/api/push/unsubscribe', { endpoint: sub.endpoint });
	await sub.unsubscribe();
}

export async function sendTest(sub: PushSubscription): Promise<void> {
	await post('/api/push/test', { endpoint: sub.endpoint });
}
