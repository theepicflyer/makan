<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	/* Burrow's labelled input. `dot` names a colour token shown before the label (macro fields). */
	let {
		label,
		value = $bindable(),
		prefix,
		suffix,
		hint,
		error,
		dot,
		class: cls = '',
		...rest
	}: {
		label: string;
		value?: string | number | null;
		prefix?: string;
		suffix?: string;
		hint?: string;
		error?: string;
		dot?: string;
		class?: string;
	} & Omit<HTMLInputAttributes, 'value' | 'prefix' | 'class'> = $props();
</script>

<label class="bh-field {error ? 'has-error' : ''} {cls}">
	<span class="bh-field__label">
		{#if dot}<span class="mk-dot" style="background: var(--{dot})"></span>{/if}{label}
	</span>
	<span class="bh-field__box">
		{#if prefix}<span class="bh-field__affix">{prefix}</span>{/if}
		<input class="bh-field__input" bind:value {...rest} />
		{#if suffix}<span class="bh-field__affix">{suffix}</span>{/if}
	</span>
	{#if error}<span class="bh-field__msg">{error}</span>{:else if hint}<span class="bh-field__hint">{hint}</span>{/if}
</label>
