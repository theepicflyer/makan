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
- Colours are tokens in `src/routes/layout.css`. Protein, carbs and fat use the first three validated categorical slots; the rest of the UI is neutral.
