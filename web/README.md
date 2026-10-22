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
- The UI is built on Burrow, the household design system ([its page](https://claude.ai/artifact/ShL86DzdjvTZDwRHLsd8L4)). `src/lib/burrow/` holds copies of its pieces: `tokens.css` (compiled from its `tokens.json`), `burrow.css` (its `bh-*` component classes) and `art.js` (the SVG drawings of the animals, traces, trails and habitats, from its `bundle.js` minus the React components). Re-sync those from the design system rather than editing them; the Svelte components beside them (`Habitat`, `Ring`, `Meter`, `Peek`…) port its React components and are ours to change. `TrailPath` is makan's own: one trail wandering down a screen behind its cards, showing in the gaps between them.
- App-specific classes (`mk-*`) and the Tailwind colour names (`bg-surface`, `text-ink-muted`, `text-accent`…) live in `src/routes/layout.css`. Use Burrow tokens, never raw colours; protein, carbs and fat are `--protein`, `--carbs` and `--fat`, and energy is makan's own `--energy` (tomato).
- Energy, protein, carbs and fat each have a symbol, `src/lib/components/NutrientIcon.svelte`: a flame, a drumstick, an ear of wheat and a drop, drawn as Burrow stickers in those colours. Use it wherever one of the four is named, never a letter (P, C, F) or a plain colour dot: before the word where there's room (meters, fields via `Field nutrient=`, table headers, tooltips), and on its own before the number where there isn't (`MacroAmounts` for a row's protein, carbs and fat; the flame before a row's calories). Pass `labelled` when no word beside it names the nutrient, so screen readers hear it. Sizes: 16 beside 14px text, 14 beside 12px labels and in `MacroAmounts`.
- Burrow's rules worth keeping when adding a screen: one habitat header and at most one full-size animal per screen (pick the animal by job: Bao for food and the assistant, Gali for history and search, Kayu for settings, editing and errors), one primary button, one trail that ends at the next action (wrap the cards in `TrailPath` with a gap between them, mark the next thing to do with `data-trail-end`, and keep anything inside it opaque or the trail shows through), and no emoji in UI text.
- Burrow is phone first and has no desktop layout, so makan adds one from 1024px (Tailwind `lg`; `wide.current` from `state.svelte.ts` where a screen changes structure, plain `lg:` classes where it only changes size). The bottom nav becomes `SideNav`, a rail with the same links (`src/lib/nav.ts`) and Bao peeking over its top edge; the page column widens to `max-w-6xl` and habitats round all four corners. Each screen keeps one habitat and one trail: Today puts the sunflower, macros and Bao's composer (`Assistant inline`) in a sticky left column beside the meals; History is a 12-column dashboard that ends at the table of days; Foods and Settings use two columns. Anything `fixed` positions itself with `--rail-w`, `--dock-h` (the bottom nav, 0 on desktop) and `--composer-h` rather than hard-coded offsets. Charts in a grid cell need `min-w-0` and a `grid-cols-1` wrapper, or a chart measuring itself widens its column.
- Charts use `src/lib/components/BarChart.svelte`: Burrow sticker bars from one baseline, an optional dashed target and trend line, one tab stop with arrow keys and a live region, a tooltip on hover or tap, and click (not tap) to open what a bar stands for. Small multiples share `bind:active` inside an element marked `data-chart-group`.
- Fredoka and Figtree are bundled from `@fontsource` (Latin only) so the PWA works offline.
