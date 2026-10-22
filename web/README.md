# makan web app

SvelteKit (Svelte 5) single-page PWA, built to `build/` and served by the FastAPI backend (`makan.main`).

```bash
npm install
npm run dev      # Vite on :5173, proxies /api, /auth and /mcp to the backend on :8000
npm run check    # svelte-check, plus tsc for the service worker
npm run build    # writes build/, which the backend serves
```

- `src/lib/api.ts` sends `X-Makan: 1` on every request; the backend rejects writes without it.
- `src/lib/components/Assistant.svelte` posts to `/api/agent/turns` and reads the server-sent events from the response body.
- New top-level routes also need adding to `SPA_ROUTES` in `src/makan/main.py`.
- The UI is built on Burrow, the household design system ([its page](https://claude.ai/artifact/ShL86DzdjvTZDwRHLsd8L4)). `src/lib/burrow/` holds copies of its pieces: `tokens.css` (compiled from its `tokens.json`), `burrow.css` (its `bh-*` component classes) and `art.js` (the SVG drawings of the animals, traces, trails and habitats, from its `bundle.js` minus the React components). Re-sync those from the design system rather than editing them; the Svelte components beside them (`Habitat`, `Ring`, `Meter`, `Peek`, `TrailGap`…) port its React components and are ours to change.
- App-specific classes (`mk-*`) and the Tailwind colour names (`bg-surface`, `text-ink-muted`, `text-accent`…) live in `src/routes/layout.css`. Use Burrow tokens, never raw colours; protein, carbs and fat are `--protein`, `--carbs` and `--fat`, always labelled.
- Burrow's rules worth keeping when adding a screen: one habitat header and at most one full-size animal per screen (pick the animal by job: Bao for food, Gali for history and search, Kayu for settings, editing and errors), one primary button, one trail that ends at the next action, and no emoji in UI text.
- Fredoka and Figtree are bundled from `@fontsource` (Latin only) so the PWA works offline.
