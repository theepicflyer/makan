# CLAUDE.md

Guidance for working in this repository.

## Project

makan is a calorie and macro tracker for a two-person household: FastAPI + SQLite backend (`src/makan/`), SvelteKit PWA (`web/`), a Claude agent that logs food from text and photos (`src/makan/agent/`), and a read-only MCP server for analysis agents (`src/makan/mcp_server.py`). Everything is served from one origin by `makan.main:app`.

## Commands

```bash
uv sync
uv run pytest                                   # backend tests (no network, fake Anthropic client)
DEV_LOGIN=true uv run uvicorn makan.main:app --reload --port 8000
cd web && npm run check && npm run build        # web app; the backend serves web/build
uv run python -m evals.run --model claude-haiku-5-5 --effort low --reps 2   # paid: real API calls
uv run python -m evals.report                   # writes evals/results/summary.md
uv run python -c "from makan.migrate import revision; revision('message')"  # new Alembic migration
```

Evals cost real money (Haiku is ~$0.001/case, Opus ~$0.02/case). Run a subset with `--cases` or `--tags` while iterating. `evals/photos` is a symlink to private photos in the main checkout and is gitignored.

## Architecture

- `foods.py`: reference loading (stable ids across reloads), FTS5 search with source boosts (Ours > SG FoodID > USDA), alias matches, hawker spelling variants, USDA de-duplication; portions (`resolve_portion`) and the editable household ("ours") foods. An alias belongs to one household food; saving it on another moves it.
- `log.py`: entries store nutrient totals copied at log time, so editing a food never rewrites history. `ChangeLog` records every agent write so a whole turn can be undone.
- `agent/`: `prompt.py` (system prompt + per-turn context), `tools.py` (7 tools, pydantic-validated, compact text results), `runner.py` (manual streaming loop, one thread per user per log date).
- `mcp_server.py`: FastMCP with `OIDCProxy` in front of Pocket ID; mounted at `/` after the API and SPA routes. Tools resolve the caller by the token's `sub`, which must match a user who has signed in to the web app.
- `web/src/lib/burrow/`: the Burrow design system (the household's shared look). `tokens.css`, `burrow.css` and `art.js` are copies of the design system's files; re-sync them rather than editing. The Svelte components next to them port its React components. `web/README.md` has the rules for new screens.
- `web/` is phone first. From 1024px (Tailwind `lg`, `wide` in `state.svelte.ts`) a side rail (`SideNav`) replaces the bottom nav and screens lay out in columns; fixed elements place themselves with `--rail-w`, `--dock-h` and `--composer-h` from `layout.css`. Charts are built on `BarChart.svelte`; History's sums and averages live in `lib/history.ts`.
- `main.py`: client-side routes are listed in `SPA_ROUTES`; anything unmatched falls through to the MCP/OAuth app. Add a route there when the web app gets a new top-level path.

## Rules that keep the agent cheap and correct

- **The system prompt is frozen text.** Never interpolate dates, user names or data into `SYSTEM_PROMPT`; per-turn context goes into the user message (`build_context`). Tools are sorted by name. Both keep the cached prefix byte-identical across users and turns.
- **History is append-only.** A turn's API messages are stored exactly as returned (`block.to_dict()`) and replayed unchanged. Editing or dropping earlier blocks breaks prompt caching and invalidates thinking blocks (new accounts get a 400 on edited history). Only `status == "ok"` turns are replayed.
- **Thinking is adaptive and effort is the only dial.** Opus 5.5 rejects disabled thinking and forced `tool_choice`. Opus/Sonnet requests send `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`); Haiku has no server-side fallback, so don't send it.
- Check `usage.cache_read_input_tokens` after any change to prompt assembly; `tests/test_agent.py` asserts the cache breakpoints and the history prefix.

## Pocket ID / MCP gotchas (same as grist-mcp)

- Never set `required_scopes` on the proxy: claude.ai requests no scopes and every call then fails "missing required scopes (has [])".
- Keep `forward_resource=False`: Pocket ID 2.18 rejects the `resource` parameter claude.ai sends.
- The FastMCP OAuth store lives in `FASTMCP_HOME` (`/data/fastmcp` in Docker). Losing it makes the claude.ai connector show as connected with no tools.
- One Pocket ID client serves both flows; it needs both callback URLs (`/auth/web/callback` and `/auth/callback`).

## Data

`data/reference/` is a committed snapshot (`scripts/fetch_sgfoodid.py`, `scripts/fetch_usda.py`). SG FoodID nutrients are per 100 g of the edible part and drinks treat 1 ml as 1 g. Its licence requires the attribution notice shown on the Settings page (text in `manifest.json`). `aliases.json` maps hawker shorthand to reference foods; a name that no longer exists logs a warning at load.

Keep README.md, this file and evals/README.md current when behaviour changes.
