<script lang="ts">
	import NutrientIcon from './NutrientIcon.svelte';
	import Sheet from './Sheet.svelte';
	import Icon from '../burrow/Icon.svelte';
	import Loader from '../burrow/Loader.svelte';
	import Mascot from '../burrow/Mascot.svelte';
	import Peek from '../burrow/Peek.svelte';
	import type { Mood } from '../burrow/art.js';
	import type { Turn, TurnChange } from '../types.ts';
	import { post } from '../api.ts';
	import { sendTurn, TOOL_LABEL } from '../agent.ts';
	import { prepareImage } from '../photo.ts';
	import { parseReply, type Span } from '../reply.ts';
	import { dayLabel, kcal } from '../format.ts';
	import { session, toasts } from '../state.svelte.ts';
	import { tick } from 'svelte';
	import { fly, scale } from '../motion.ts';

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
		photoUrls: string[];
		reply: string;
		tool: string | null;
		error: string | null;
	}

	let open = $state(false);
	let text = $state('');
	// Same limit as the server (MAX_PHOTOS in api.py).
	const MAX_PHOTOS = 6;
	let photos = $state<{ blob: Blob; url: string }[]>([]);
	let turns = $state<Turn[]>([]);
	let pending = $state<Pending | null>(null);
	let sending = $state(false);
	let fileInput: HTMLInputElement | undefined = $state();
	let cameraInput: HTMLInputElement | undefined = $state();
	// Which composer (docked or in the sheet) has its photo menu open; both can be on screen at once.
	let photoMenu = $state<boolean | null>(null);
	let end: HTMLDivElement | undefined = $state();
	// Each time Bao opens is a new conversation; the server returns its id with the first turn.
	let threadId: number | null = null;
	let conversation = 0;
	let shownDate = '';

	// Bao, makan's host in Burrow, is the face of the assistant.
	const title = $derived(`Bao · ${dayLabel(date, session.me?.today ?? date)}`);
	const canSend = $derived(!sending && (text.trim().length > 0 || photos.length > 0));

	function reset() {
		conversation++;
		threadId = null;
		turns = [];
		pending = null;
	}

	$effect(() => {
		if (date !== shownDate) {
			shownDate = date;
			reset();
		}
	});

	// Closing Bao ends the conversation, but a reply still streaming finishes first.
	$effect(() => {
		if (!open && !sending) reset();
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

	async function pickPhotos(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const files = [...(input.files ?? [])];
		input.value = '';
		const room = MAX_PHOTOS - photos.length;
		if (files.length > room) toasts.error(`Up to ${MAX_PHOTOS} photos in one message`);
		for (const file of files.slice(0, Math.max(room, 0))) {
			const blob = await prepareImage(file);
			photos.push({ blob, url: URL.createObjectURL(blob) });
		}
	}

	// Phones get a choice of camera or library; elsewhere `capture` is ignored, so go straight to the file picker.
	function attachPhoto(docked: boolean) {
		if (matchMedia('(pointer: coarse)').matches) photoMenu = photoMenu === docked ? null : docked;
		else fileInput?.click();
	}

	function choosePhoto(input: HTMLInputElement | undefined) {
		photoMenu = null;
		input?.click();
	}

	function closePhotoMenu(e: Event) {
		if (photoMenu == null) return;
		if (e instanceof KeyboardEvent ? e.key === 'Escape' : !(e.target as Element).closest?.('[data-photo-menu]')) photoMenu = null;
	}

	function removePhoto(i: number) {
		URL.revokeObjectURL(photos[i].url);
		photos.splice(i, 1);
	}

	async function send() {
		if (!canSend) return;
		const d = date;
		const conv = conversation;
		const message = text.trim();
		const images = photos.map((p) => p.blob);
		pending = { text: message, photoUrls: photos.map((p) => p.url), reply: '', tool: null, error: null };
		text = '';
		photos = [];
		sending = true;
		open = true;
		pin();
		try {
			for await (const ev of sendTurn(d, message, images, threadId)) {
				if (conv !== conversation || !pending) break;
				if (ev.type === 'turn') {
					threadId = ev.thread_id;
				} else if (ev.type === 'text') {
					pending.reply += ev.delta;
					pending.tool = null;
					scrollDown(false);
				} else if (ev.type === 'tool') {
					pending.tool = TOOL_LABEL[ev.name] ?? 'Working';
				} else if (ev.type === 'changed') {
					onchanged();
				} else if (ev.type === 'done') {
					turns = [...turns, ev.turn];
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

	function foodLabel(c: TurnChange): string {
		return { create: 'New food', update: 'Updated', delete: 'Deleted' }[c.action];
	}

	// Removed entries are struck through; a changed one is named only when the card also adds some.
	function marksChanged(changes: TurnChange[]): boolean {
		return changes.some((c) => c.table === 'entries' && c.action === 'create');
	}

	// A card with more than one kind of food change labels each food row; otherwise the heading says it.
	function mixedFoods(changes: TurnChange[]): boolean {
		return new Set(changes.filter((c) => c.table === 'foods').map((c) => c.action)).size > 1;
	}

	// The card's heading: "Saved 3 foods", "Logged 4 · Removed 1".
	function changesTitle(changes: TurnChange[]): string {
		const verbs: Record<string, [string, string]> = {
			'foods create': ['Saved', ' food'],
			'foods update': ['Updated', ' food'],
			'foods delete': ['Deleted', ' food'],
			'entries create': ['Logged', ''],
			'entries update': ['Changed', ''],
			'entries delete': ['Removed', '']
		};
		const counts = new Map<string, number>();
		for (const c of changes) {
			const key = `${c.table} ${c.action}`;
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
		return [...counts]
			.map(([key, n]) => {
				const [verb, noun] = verbs[key];
				return `${verb} ${n}${noun}${noun && n !== 1 ? 's' : ''}`;
			})
			.join(' · ');
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
		<div class="relative shrink-0" data-photo-menu>
			<button
				type="button"
				class="bh-btn bh-btn--ghost bh-btn--icon min-h-11 w-11"
				aria-label="Attach a photo"
				aria-expanded={photoMenu === docked}
				onclick={() => attachPhoto(docked)}
			>
				<Icon name="camera" size={22} />
			</button>
			{#if photoMenu === docked}
				<div
					class="absolute bottom-full left-0 z-10 mb-2 flex w-48 origin-bottom-left flex-col rounded-[var(--radius-sm)] border-2 border-outline bg-surface p-1 shadow-[var(--shadow-lift)]"
					transition:scale={{ start: 0.85, duration: 160 }}
				>
					<button type="button" class="bh-btn bh-btn--ghost min-h-11 justify-start gap-2 px-3" onclick={() => choosePhoto(cameraInput)}>
						<Icon name="camera" size={20} />Take a photo
					</button>
					<button type="button" class="bh-btn bh-btn--ghost min-h-11 justify-start gap-2 px-3" onclick={() => choosePhoto(fileInput)}>
						<Icon name="image" size={20} />Choose a photo
					</button>
				</div>
			{/if}
		</div>
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
	{#if photos.length}
		<div class="pointer-events-auto mb-2 flex flex-wrap items-center gap-3 pt-2">
			{#each photos as p, i (p.url)}
				<div class="mk-pop-in relative" out:scale={{ start: 0.6, duration: 150 }}>
					<img src={p.url} alt="Attached" class="h-16 w-16 rounded-[var(--radius-sm)] border-2 border-outline object-cover" />
					<button
						class="absolute -top-2 -right-2 grid h-7 w-7 place-items-center rounded-full border-2 border-outline bg-surface text-ink"
						aria-label="Remove photo"
						onclick={() => removePhoto(i)}
					>
						<Icon name="close" size={14} />
					</button>
				</div>
			{/each}
			<span class="small rounded-full bg-surface px-3 py-1 text-ink-muted">Add a note, or send as is</span>
		</div>
	{/if}
{/snippet}

{#snippet spans(line: Span[])}
	{#each line as s, i (i)}{#if s.bold}<strong class="font-semibold">{s.text}</strong>{:else}{s.text}{/if}{/each}
{/snippet}

{#snippet replyText(text: string)}
	<div class="space-y-2 whitespace-normal">
		{#each parseReply(text) as block, i (i)}
			{#if block.kind === 'ul'}
				<ul class="list-disc space-y-1 pl-5">
					{#each block.items as item, j (j)}<li>{@render spans(item)}</li>{/each}
				</ul>
			{:else}
				<p>{#each block.lines as line, j (j)}{#if j}<br />{/if}{@render spans(line)}{/each}</p>
			{/if}
		{/each}
	</div>
{/snippet}

{#snippet sentPhotos(urls: string[])}
	{#if urls.length}
		<div class="flex flex-wrap justify-end gap-1">
			{#each urls as url (url)}
				<img
					src={url}
					alt="Sent"
					class="rounded-[20px] border-2 border-outline object-cover {urls.length > 1 ? 'h-28 w-28' : 'max-h-48'}"
					onload={onImageLoad}
				/>
			{/each}
		</div>
	{/if}
{/snippet}

<svelte:window onpointerdown={closePhotoMenu} onkeydown={closePhotoMenu} />
<input bind:this={fileInput} type="file" accept="image/*" multiple class="hidden" onchange={pickPhotos} />
<input bind:this={cameraInput} type="file" accept="image/*" capture="environment" class="hidden" onchange={pickPhotos} />

{#if inline}
	<div>
		{@render attached()}
		<Peek character="bao" mood={sending ? 'busy' : 'happy'} size={52} side="left" offset={22}>
			{@render composer(true)}
		</Peek>
	</div>
{:else if !open}
	<div class="pointer-events-none fixed left-0 z-20 px-4" style="right: var(--fold-right); bottom: calc(env(safe-area-inset-bottom) + var(--nav-gap) + var(--nav-h) + 10px)">
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
				{#if turn.user_text || turn.photo_ids.length}
					<div class="ml-auto flex max-w-[85%] flex-col items-end gap-1">
						{@render sentPhotos(turn.photo_ids.map((id) => `/api/photos/${id}`))}
						{#if turn.user_text}
							<div class="mk-bubble mk-bubble--me">{turn.user_text}</div>
						{/if}
					</div>
				{/if}
				<div>
					<div class="flex max-w-[92%] items-end gap-2">
						<Mascot character="bao" mood={replyMood(turn)} size={40} />
						<div class="mk-bubble mk-bubble--them min-w-0">
							{#if turn.reply_text}{@render replyText(turn.reply_text)}{:else}{turn.status === 'error' ? 'Something went wrong. Try sending it again.' : '…'}{/if}
						</div>
					</div>
					{#if turn.changes.length}
						<div class="mk-rise-in mt-1.5 ml-12 rounded-[var(--radius-md)] border-2 border-line px-3 py-1.5 transition-opacity {turn.undone ? 'opacity-60' : ''}">
							<div class="flex items-center justify-between gap-2">
								<span class="small font-semibold text-ink-muted">{changesTitle(turn.changes)}</span>
								{#if turn.undone}
									<span class="small py-2 text-ink-muted">Undone</span>
								{:else}
									<button class="bh-btn bh-btn--ghost bh-btn--sm -mr-2" onclick={() => undo(turn)}>Undo</button>
								{/if}
							</div>
							<ul class="small divide-y divide-line {turn.undone ? 'line-through' : ''}">
								{#each turn.changes as c, i (i)}
									{@const removed = c.action === 'delete'}
									<li class="flex items-start gap-2 py-1.5 {removed ? 'text-ink-muted line-through' : ''}">
										{#if c.table === 'foods'}
											{@const detail = [mixedFoods(turn.changes) ? foodLabel(c) : '', c.serving ? `per ${c.serving}` : ''].filter(Boolean).join(' · ')}
											<div class="min-w-0 flex-1">
												{#if removed || turn.undone}
													<span class="font-semibold">{c.name ?? '–'}</span>
												{:else}
													<a href="/foods/{c.row_id}" class="font-semibold text-ink underline decoration-line underline-offset-2">{c.name ?? '–'}</a>
												{/if}
												{#if detail}<p class="text-ink-muted">{detail}</p>{/if}
												{#if c.aliases?.length}<p class="text-ink-muted">Answers to {c.aliases.map((a) => `“${a}”`).join(', ')}</p>{/if}
											</div>
										{:else}
											<span class="min-w-0 flex-1 truncate">{#if c.action === 'update' && marksChanged(turn.changes)}<span class="text-ink-muted">Changed </span>{/if}{c.name ?? '–'}</span>
										{/if}
										{#if c.kcal != null}
											<span class="bh-num shrink-0 font-semibold"><NutrientIcon kind="energy" labelled />{kcal(c.kcal)}</span>
										{/if}
									</li>
								{/each}
							</ul>
						</div>
					{/if}
				</div>
			</div>
		{/each}
		{#if pending}
			<!-- the message just sent rises into the chat -->
			<div class="space-y-2" in:fly={{ y: 16, duration: 260 }}>
				<div class="ml-auto flex max-w-[85%] flex-col items-end gap-1">
					{@render sentPhotos(pending.photoUrls)}
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
							{#if pending.reply}{@render replyText(pending.reply)}{/if}
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
