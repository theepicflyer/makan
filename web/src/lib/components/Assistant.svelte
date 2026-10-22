<script lang="ts">
	import Sheet from './Sheet.svelte';
	import Icon from '../burrow/Icon.svelte';
	import Loader from '../burrow/Loader.svelte';
	import Mascot from '../burrow/Mascot.svelte';
	import Peek from '../burrow/Peek.svelte';
	import type { Mood } from '../burrow/art.js';
	import type { Turn, TurnChange } from '../types.ts';
	import { get, post } from '../api.ts';
	import { sendTurn, TOOL_LABEL } from '../agent.ts';
	import { prepareImage } from '../photo.ts';
	import { dayLabel, kcal } from '../format.ts';
	import { session, toasts } from '../state.svelte.ts';
	import { tick } from 'svelte';

	let {
		date,
		onchanged,
		inline = false
	}: {
		date: string;
		onchanged: () => void;
		/** Desktop: the composer sits in the page where it's placed, instead of floating over the nav. */
		inline?: boolean;
	} = $props();

	interface Pending {
		text: string;
		photoUrl: string | null;
		reply: string;
		tool: string | null;
		error: string | null;
	}

	let open = $state(false);
	let text = $state('');
	let photo = $state<Blob | null>(null);
	let photoUrl = $state<string | null>(null);
	let turns = $state<Turn[]>([]);
	let pending = $state<Pending | null>(null);
	let sending = $state(false);
	let fileInput: HTMLInputElement | undefined = $state();
	let end: HTMLDivElement | undefined = $state();
	let loadedDate = '';

	// Bao, makan's host in Burrow, is the face of the assistant.
	const title = $derived(`Bao · ${dayLabel(date, session.me?.today ?? date)}`);
	const canSend = $derived(!sending && (text.trim().length > 0 || photo != null));

	$effect(() => {
		if (date !== loadedDate) {
			loadedDate = date;
			pending = null;
			loadThread(date);
		}
	});

	// Photos load after the first scroll and push the end down; keep pinning to the bottom briefly.
	let pinUntil = 0;
	function pin(ms = 2500) {
		pinUntil = Date.now() + ms;
		scrollDown();
	}
	function onImageLoad() {
		scrollDown(Date.now() < pinUntil);
	}

	$effect(() => {
		if (open) pin();
	});

	async function loadThread(d: string) {
		try {
			const res = await get<{ turns: Turn[] }>(`/api/agent/threads/${d}`);
			if (d === date) turns = res.turns;
		} catch {
			turns = [];
		}
	}

	function scroller(): HTMLElement | null {
		return end?.closest<HTMLElement>('.overflow-y-auto') ?? null;
	}

	function nearBottom(): boolean {
		const el = scroller();
		return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 160;
	}

	async function scrollDown(force = true) {
		if (!force && !nearBottom()) return;
		await tick();
		const el = scroller();
		if (el) el.scrollTop = el.scrollHeight;
	}

	async function pickPhoto(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		const blob = await prepareImage(file);
		if (photoUrl) URL.revokeObjectURL(photoUrl);
		photo = blob;
		photoUrl = URL.createObjectURL(blob);
		if (fileInput) fileInput.value = '';
	}

	function clearPhoto() {
		photo = null;
		photoUrl = null;
	}

	async function send() {
		if (!canSend) return;
		const d = date;
		const message = text.trim();
		const image = photo;
		pending = { text: message, photoUrl, reply: '', tool: null, error: null };
		text = '';
		photo = null;
		photoUrl = null;
		sending = true;
		open = true;
		pin();
		try {
			for await (const ev of sendTurn(d, message, image)) {
				if (!pending) break;
				if (ev.type === 'text') {
					pending.reply += ev.delta;
					pending.tool = null;
					scrollDown(false);
				} else if (ev.type === 'tool') {
					pending.tool = TOOL_LABEL[ev.name] ?? 'Working';
				} else if (ev.type === 'changed') {
					onchanged();
				} else if (ev.type === 'done') {
					if (d === date) turns = [...turns, ev.turn];
					pending = null;
					onchanged();
					pin();
				} else if (ev.type === 'error') {
					pending.error = ev.message;
					pending.tool = null;
					onchanged();
				}
			}
		} catch (err) {
			if (pending) pending.error = (err as Error).message || 'Connection lost';
		} finally {
			sending = false;
		}
	}

	async function undo(turn: Turn) {
		try {
			const updated = await post<Turn>(`/api/agent/turns/${turn.id}/undo`);
			turns = turns.map((t) => (t.id === turn.id ? updated : t));
			onchanged();
		} catch (err) {
			toasts.error((err as Error).message);
		}
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
			e.preventDefault();
			send();
		}
	}

	function autosize(node: HTMLTextAreaElement) {
		const resize = () => {
			node.style.height = 'auto';
			node.style.height = `${Math.min(node.scrollHeight, 120)}px`;
		};
		$effect(() => {
			void text;
			resize();
		});
		node.addEventListener('input', resize);
		return { destroy: () => node.removeEventListener('input', resize) };
	}

	// Glad when a message logged something, worried when it failed.
	function replyMood(turn: Turn): Mood {
		if (turn.status === 'error') return 'worried';
		return turn.changes.length && !turn.undone ? 'joy' : 'happy';
	}

	function changeLabel(c: TurnChange): string {
		if (c.table === 'foods') {
			return { create: 'New food', update: 'Updated food', delete: 'Deleted food' }[c.action];
		}
		return { create: 'Added', update: 'Changed', delete: 'Removed' }[c.action];
	}
</script>

{#snippet composer(docked: boolean)}
	<form
		class="mk-composer pointer-events-auto {docked ? 'shadow-[var(--shadow-lift)]' : ''}"
		onsubmit={(e) => {
			e.preventDefault();
			send();
		}}
	>
		<button type="button" class="bh-btn bh-btn--ghost bh-btn--icon shrink-0 min-h-11 w-11" aria-label="Attach a photo" onclick={() => fileInput?.click()}>
			<Icon name="camera" size={22} />
		</button>
		<textarea
			use:autosize
			bind:value={text}
			{onkeydown}
			rows="1"
			enterkeyhint="send"
			placeholder={docked ? 'Tell Bao what you ate' : 'Reply or correct something…'}
			aria-label="Message Bao"
			class="body max-h-[120px] min-h-11 min-w-0 flex-1 resize-none bg-transparent py-2.5 text-ink outline-none placeholder:text-ink-muted focus-visible:outline-none"
		></textarea>
		{#if docked && (turns.length || pending)}
			<button
				type="button"
				class="bh-btn bh-btn--ghost bh-btn--icon relative shrink-0 min-h-11 w-11"
				aria-label="Show the chat with Bao"
				onclick={() => (open = true)}
			>
				<Icon name="chat" size={22} />
				{#if sending}
					<span class="absolute top-2 right-2 h-2.5 w-2.5 rounded-full border-2 border-outline bg-accent motion-safe:animate-pulse"></span>
				{/if}
			</button>
		{/if}
		<button type="submit" class="bh-btn bh-btn--primary bh-btn--icon shrink-0 min-h-11 w-11" aria-label="Send" disabled={!canSend}>
			<Icon name="arrow-up" size={20} />
		</button>
	</form>
{/snippet}

{#snippet attached()}
	{#if photoUrl}
		<div class="pointer-events-auto mb-2 flex items-center gap-2">
			<div class="relative">
				<img src={photoUrl} alt="Attached" class="h-16 w-16 rounded-[var(--radius-sm)] border-2 border-outline object-cover" />
				<button
					class="absolute -top-2 -right-2 grid h-7 w-7 place-items-center rounded-full border-2 border-outline bg-surface text-ink"
					aria-label="Remove photo"
					onclick={clearPhoto}
				>
					<Icon name="close" size={14} />
				</button>
			</div>
			<span class="small rounded-full bg-surface px-3 py-1 text-ink-muted">Add a note, or send as is</span>
		</div>
	{/if}
{/snippet}

<input bind:this={fileInput} type="file" accept="image/*" class="hidden" onchange={pickPhoto} />

{#if inline}
	<div>
		{@render attached()}
		<Peek character="bao" mood={sending ? 'busy' : 'happy'} size={52} side="left" offset={22}>
			{@render composer(true)}
		</Peek>
	</div>
{:else if !open}
	<div class="pointer-events-none fixed inset-x-0 z-20 px-4" style="bottom: calc(env(safe-area-inset-bottom) + var(--nav-gap) + var(--nav-h) + 10px)">
		<div class="mx-auto max-w-lg">
			{@render attached()}
			<!-- Bao listens over the composer, nibbling while working on a message -->
			<Peek character="bao" mood={sending ? 'busy' : 'happy'} size={52} side="left" offset={22}>
				{@render composer(true)}
			</Peek>
		</div>
	</div>
{/if}

<Sheet bind:open {title} tall>
	<div class="space-y-4 pt-1 pb-2">
		{#if !turns.length && !pending}
			<div class="bh-card bh-card--tint flex gap-3">
				<Mascot character="bao" mood="happy" size={72} />
				<div class="body min-w-0">
					<p class="font-semibold">I'm Bao. Tell me what you ate, in any order.</p>
					<p class="mt-1 text-ink-muted">“Breakfast kopi c and 2 kaya toast, lunch chicken rice, dinner a bowl of yogurt.”</p>
					<p class="mt-1 text-ink-muted">Send a meal photo, or a nutrition label to save a food. I log straight away; just tell me if something's off.</p>
				</div>
			</div>
		{/if}
		{#each turns as turn (turn.id)}
			<div class="space-y-2">
				{#if turn.user_text || turn.photo_id}
					<div class="ml-auto flex max-w-[85%] flex-col items-end gap-1">
						{#if turn.photo_id}
							<img src="/api/photos/{turn.photo_id}" alt="Sent" class="max-h-48 rounded-[20px] border-2 border-outline object-cover" onload={onImageLoad} />
						{/if}
						{#if turn.user_text}
							<div class="mk-bubble mk-bubble--me">{turn.user_text}</div>
						{/if}
					</div>
				{/if}
				<div>
					<div class="flex max-w-[92%] items-end gap-2">
						<Mascot character="bao" mood={replyMood(turn)} size={40} />
						<div class="mk-bubble mk-bubble--them min-w-0">{turn.reply_text || (turn.status === 'error' ? 'Something went wrong. Try sending it again.' : '…')}</div>
					</div>
					{#if turn.changes.length}
						<div class="mt-1.5 ml-12 rounded-[var(--radius-md)] border-2 border-line px-3 py-2 {turn.undone ? 'opacity-60' : ''}">
							<ul class="small space-y-1">
								{#each turn.changes as c, i (i)}
									<li class="flex gap-2 {turn.undone ? 'line-through' : ''}">
										<span class="w-16 shrink-0 text-ink-muted">{changeLabel(c)}</span>
										<span class="min-w-0 flex-1 truncate">{c.name ?? '–'}</span>
										{#if c.table === 'entries' && c.kcal != null}
											<span class="bh-num shrink-0 font-semibold">{kcal(c.kcal)}</span>
										{/if}
									</li>
								{/each}
							</ul>
							<div class="mt-1 flex justify-end">
								{#if turn.undone}
									<span class="small py-2 text-ink-muted">Undone</span>
								{:else}
									<button class="bh-btn bh-btn--ghost bh-btn--sm" onclick={() => undo(turn)}>Undo</button>
								{/if}
							</div>
						</div>
					{/if}
				</div>
			</div>
		{/each}
		{#if pending}
			<div class="space-y-2">
				<div class="ml-auto flex max-w-[85%] flex-col items-end gap-1">
					{#if pending.photoUrl}
						<img src={pending.photoUrl} alt="Sent" class="max-h-48 rounded-[20px] border-2 border-outline object-cover" onload={onImageLoad} />
					{/if}
					{#if pending.text}
						<div class="mk-bubble mk-bubble--me">{pending.text}</div>
					{/if}
				</div>
				<div class="flex max-w-[92%] items-end gap-2">
					{#if pending.error}
						<Mascot character="bao" mood="worried" size={40} />
						<div class="mk-bubble min-w-0 border-2 border-tomato-text font-semibold text-tomato-text">{pending.error}</div>
					{:else}
						<Mascot character="bao" mood="busy" size={40} />
						<div class="mk-bubble mk-bubble--them min-w-0">
							{#if pending.reply}{pending.reply}{/if}
							{#if pending.tool || !pending.reply}
								<span class="flex items-center gap-2 text-ink-muted">
									<Loader kind="crumbs" />
									<span class="small">{pending.tool ? `${pending.tool}…` : 'Thinking…'}</span>
								</span>
							{/if}
						</div>
					{/if}
				</div>
			</div>
		{/if}
		<div bind:this={end}></div>
	</div>
	{#snippet footer()}
		{@render attached()}
		{@render composer(false)}
	{/snippet}
</Sheet>
