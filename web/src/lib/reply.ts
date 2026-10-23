/** A run of text in one of Bao's replies; `bold` came from **…**. */
export interface Span {
	text: string;
	bold: boolean;
}

export type Block = { kind: 'p'; lines: Span[][] } | { kind: 'ul'; items: Span[][] };

const BULLET = /^\s*[-*•]\s+/;

function spans(line: string): Span[] {
	return line
		.split(/\*\*(.+?)\*\*/g)
		.map((text, i) => ({ text, bold: i % 2 === 1 }))
		.filter((s) => s.text);
}

/**
 * Bao's reply as paragraphs and bullet lists. The model sometimes writes **bold** and "- " lists
 * despite the prompt; render those instead of showing the asterisks. Everything else stays text.
 */
export function parseReply(text: string): Block[] {
	const blocks: Block[] = [];
	let open = false;
	for (const line of text.split('\n')) {
		const last = open ? blocks[blocks.length - 1] : undefined;
		open = !!line.trim();
		if (!open) continue;
		if (BULLET.test(line)) {
			const item = spans(line.replace(BULLET, ''));
			if (last?.kind === 'ul') last.items.push(item);
			else blocks.push({ kind: 'ul', items: [item] });
		} else if (last?.kind === 'p') {
			last.lines.push(spans(line));
		} else {
			blocks.push({ kind: 'p', lines: [spans(line)] });
		}
	}
	return blocks;
}
