<script lang="ts">
	import Sheet from './Sheet.svelte';
	import type { Turn, TurnChange } from '../types.ts';
	import { get, post } from '../api.ts';
	import { sendTurn, TOOL_LABEL } from '../agent.ts';
	import { prepareImage } from '../photo.ts';
	import { dayLabel, kcal } from '../format.ts';
	import { session, toasts } from '../state.svelte.ts';
	import { tick } from 'svelte';

	let { date, onchanged }: { date: string; onchanged: () => void } = $props();

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

	const title = $derived(`Assistant · ${dayLabel(date, session.me?.today ?? date)}`);
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

	function changeLabel(c: TurnChange): string {
		if (c.table === 'foods') {
			return { create: 'New food', update: 'Updated food', delete: 'Deleted food' }[c.action];
		}
		return { create: 'Added', update: 'Changed', delete: 'Removed' }[c.action];
	}
</script>

{#snippet composer(docked: boolean)}
	<div class="w-full">
		{#if photoUrl}
			<div class="mb-2 flex items-center gap-2">
				<div class="relative">
					<img src={photoUrl} alt="Attached" class="h-16 w-16 rounded-xl border border-line object-cover" />
					<button
						class="absolute -top-2 -right-2 grid h-7 w-7 place-items-center rounded-full bg-ink text-surface"
						aria-label="Remove photo"
						onclick={clearPhoto}
					>
						<svg width="12" height="12" viewBox="0 0 16 16" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
					</button>
				</div>
				<span class="text-[13px] text-muted">Add a note, or send as is</span>
			</div>
		{/if}
		<form
			class="flex items-end gap-1 rounded-[26px] border border-line bg-surface-2 p-1 focus-within:border-ink {docked ? 'shadow-lg' : ''}"
			onsubmit={(e) => {
				e.preventDefault();
				send();
			}}
		>
			<button
				type="button"
				class="grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-wash"
				aria-label="Attach a photo"
				onclick={() => fileInput?.click()}
			>
				<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l1.5-2h7L17 8h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
			</button>
			<textarea
				use:autosize
				bind:value={text}
				{onkeydown}
				rows="1"
				enterkeyhint="send"
				placeholder={docked ? 'What did you eat?' : 'Reply or correct something…'}
				aria-label="Message the assistant"
				class="max-h-[120px] min-h-11 min-w-0 flex-1 resize-none bg-transparent py-2.5 leading-6 outline-none placeholder:text-muted focus-visible:outline-none"
			></textarea>
			{#if docked && (turns.length || pending)}
				<button
					type="button"
					class="relative grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-wash"
					aria-label="Show conversation"
					onclick={() => (open = true)}
				>
					<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z" /></svg>
					{#if sending}
						<span class="absolute top-2 right-2 h-2 w-2 animate-pulse rounded-full bg-ink"></span>
					{/if}
				</button>
			{/if}
			<button
				type="submit"
				class="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ink text-surface disabled:opacity-30"
				aria-label="Send"
				disabled={!canSend}
			>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
			</button>
		</form>
	</div>
{/snippet}

<input bind:this={fileInput} type="file" accept="image/*" class="hidden" onchange={pickPhoto} />

{#if !open}
	<div class="fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom))] z-20 px-3 pb-2">
		<div class="mx-auto max-w-lg">
			{@render composer(true)}
		</div>
	</div>
{/if}

<Sheet bind:open {title} tall>
	<div class="space-y-4 pt-1 pb-2">
		{#if !turns.length && !pending}
			<div class="rounded-2xl bg-wash px-4 py-3 text-[14px] text-ink-2">
				<p class="font-medium text-ink">Tell me what you ate, in any order.</p>
				<p class="mt-1">“Breakfast kopi c and 2 kaya toast, lunch chicken rice, dinner a bowl of yogurt.”</p>
				<p class="mt-1">Send a meal photo, or a nutrition label to save a food. I log straight away; just tell me if something's off.</p>
			</div>
		{/if}
		{#each turns as turn (turn.id)}
			<div class="space-y-2">
				{#if turn.user_text || turn.photo_id}
					<div class="ml-auto flex max-w-[85%] flex-col items-end gap-1">
						{#if turn.photo_id}
							<img src="/api/photos/{turn.photo_id}" alt="Sent" class="max-h-48 rounded-2xl border border-line object-cover" onload={onImageLoad} />
						{/if}
						{#if turn.user_text}
							<div class="rounded-2xl rounded-br-md bg-ink px-3.5 py-2 text-[15px] whitespace-pre-wrap text-surface">{turn.user_text}</div>
						{/if}
					</div>
				{/if}
				<div class="max-w-[92%]">
					<div class="rounded-2xl rounded-bl-md bg-wash px-3.5 py-2.5 text-[15px] whitespace-pre-wrap">{turn.reply_text || (turn.status === 'error' ? 'Something went wrong.' : '…')}</div>
					{#if turn.changes.length}
						<div class="mt-1.5 rounded-xl border border-line px-3 py-2 text-[13px] {turn.undone ? 'opacity-60' : ''}">
							<ul class="space-y-0.5">
								{#each turn.changes as c, i (i)}
									<li class="flex gap-2 {turn.undone ? 'line-through' : ''}">
										<span class="w-16 shrink-0 text-muted">{changeLabel(c)}</span>
										<span class="min-w-0 flex-1 truncate">{c.name ?? '—'}</span>
										{#if c.table === 'entries' && c.kcal != null}
											<span class="shrink-0 tabular text-ink-2">{kcal(c.kcal)}</span>
										{/if}
									</li>
								{/each}
							</ul>
							<div class="mt-1.5 flex justify-end">
								{#if turn.undone}
									<span class="py-1 text-muted">Undone</span>
								{:else}
									<button class="min-h-9 rounded-full px-3 font-semibold text-ink hover:bg-wash" onclick={() => undo(turn)}>Undo</button>
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
						<img src={pending.photoUrl} alt="Sent" class="max-h-48 rounded-2xl border border-line object-cover" onload={onImageLoad} />
					{/if}
					{#if pending.text}
						<div class="rounded-2xl rounded-br-md bg-ink px-3.5 py-2 text-[15px] whitespace-pre-wrap text-surface">{pending.text}</div>
					{/if}
				</div>
				<div class="max-w-[92%]">
					{#if pending.error}
						<div class="rounded-2xl rounded-bl-md border border-critical px-3.5 py-2.5 text-[15px] text-critical-text">{pending.error}</div>
					{:else}
						<div class="rounded-2xl rounded-bl-md bg-wash px-3.5 py-2.5 text-[15px] whitespace-pre-wrap">
							{#if pending.reply}{pending.reply}{/if}
							{#if pending.tool || !pending.reply}
								<span class="flex items-center gap-2 text-ink-2">
									<span class="inline-flex gap-0.5" aria-hidden="true">
										<span class="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-2 [animation-delay:-0.2s]"></span>
										<span class="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-2 [animation-delay:-0.1s]"></span>
										<span class="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-2"></span>
									</span>
									{pending.tool ? `${pending.tool}…` : 'Thinking…'}
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
		{@render composer(false)}
	{/snippet}
</Sheet>
