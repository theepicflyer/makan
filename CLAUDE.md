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
- `agent/`: `prompt.py` (system prompt + per-turn context), `tools.py` (7 tools, pydantic-validated, compact text results), `runner.py` (manual streaming loop, one thread per user per log date). A turn's photos are the `photo_ref` blocks in its first stored message (`turn_photo_ids`); `turns.photo_id` holds only the first.
- `reminders.py`: daily reminders as Web Push. A task started in the app's lifespan checks once a minute (one uvicorn process, so nothing double-sends; tests set `REMINDERS=false` and call `tick()`). Each user has one `reminder_time`; each device that turned reminders on is a `push_subscriptions` row. A day with breakfast, lunch and dinner logged gets no reminder, and `reminded_on` keeps it to one a day. The VAPID key is made on first use in `DATA_DIR`; subscriptions are tied to it. Endpoints are limited to the browsers' push services (`PUSH_HOSTS`).
- `mcp_server.py`: FastMCP with `OIDCProxy` in front of Pocket ID; mounted at `/` after the API and SPA routes. Tools resolve the caller by the token's `sub`, which must match a user who has signed in to the web app.
- `web/src/lib/burrow/`: the Burrow design system (the household's shared look). `tokens.css`, `burrow.css` and `art.js` are copies of the design system's files; re-sync them rather than editing. The Svelte components next to them port its React components. `web/README.md` has the rules for new screens.
- `web/` is phone first. From 1024px (Tailwind `lg`, `wide` in `state.svelte.ts`) a side rail (`SideNav`) replaces the bottom nav and screens lay out in columns; fixed elements place themselves with `--rail-w`, `--dock-h` and `--composer-h` from `layout.css`. Charts are built on `BarChart.svelte`; History's sums and averages live in `lib/history.ts`. Energy, protein, carbs and fat are always marked with `NutrientIcon` (flame, drumstick, wheat, drop), never letters or colour dots.
- `main.py`: client-side routes are listed in `SPA_ROUTES`; anything unmatched falls through to the MCP/OAuth app. Add a route there when the web app gets a new top-level path.

## Rules that keep the agent cheap and correct

- **The system prompt is frozen text.** Never interpolate dates, user names or data into `SYSTEM_PROMPT`; per-turn context goes into the user message (`build_context`). Tools are sorted by name. Both keep the cached prefix byte-identical across users and turns.
- **History is append-only.** A turn's API messages are stored exactly as returned (`block.to_dict()`) and replayed unchanged. Editing or dropping earlier blocks breaks prompt caching and invalidates thinking blocks (new accounts get a 400 on edited history). Only `status == "ok"` turns are replayed.
- **Stale thinking is dropped, not rejected.** A thinking block is bound to the system prompt, tools and earlier messages it was made with, so a release that changes the prompt or tools would 400 every thread started before it. Requests send `thinking.block_binding.prefix_mismatch_behavior: "drop_block"` (beta `thinking-binding-controls-2026-08-01`); dropped blocks are logged. History edits are still forbidden: dropping loses the reasoning and the cache.
- **Thinking is adaptive and effort is the only dial.** Opus 5.5 rejects disabled thinking and forced `tool_choice`. Opus/Sonnet requests send `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`); Haiku has no server-side fallback, so don't send it.
- Check `usage.cache_read_input_tokens` after any change to prompt assembly; `tests/test_agent.py` asserts the cache breakpoints and the history prefix.

## Pocket ID / MCP gotchas (same as grist-mcp)

- Never set `required_scopes` on the proxy: claude.ai requests no scopes and every call then fails "missing required scopes (has [])".
- Keep `forward_resource=False`: Pocket ID 2.18 rejects the `resource` parameter claude.ai sends.
- The FastMCP OAuth store lives in `FASTMCP_HOME` (`/data/fastmcp` in Docker). Losing it makes the claude.ai connector show as connected with no tools.
- One Pocket ID client serves both flows; it needs both callback URLs (`/auth/web/callback` and `/auth/callback`).

## Releases and deploy

Images go to `ghcr.io/theepicflyer/makan`. Two workflows plus a reusable build:

- `ci.yml`: `pytest` and the web app's `npm run check` on every PR; also called by `release.yml`.
- `release.yml`: on every push to `main`, runs the tests, then `.github/scripts/plan-release.sh` looks at the PRs that push merged. If any carries a `version/*` label it bumps from the latest GitHub release, pushes `:X.Y.Z` + `:latest`, then creates the release **last** (so a release never points at a missing image). No label: it pushes `:nightly` only. `workflow_dispatch` builds a one-off `:<tag>` from any ref.
- `build-push.yml`: the one place the Docker build lives (amd64). The image's `org.opencontainers.image.revision` label is the commit it was built from.

### Shipping a change

A release is how work reaches production: the production server polls for new releases, has each one security-reviewed by an agent, and deploys it. So:

- **One PR per piece of work.** If it is too big for one PR, stack PRs with `gh stack` (`gh extension install github/gh-stack`; `gh stack init`, `gh stack add`, `gh stack submit`) and merge the stack together.
- **Exactly one `version/*` label per release**, on the single PR or on the **top** PR of a stack. Leave the lower PRs of a stack unlabeled; one push merging the stack makes one release. If several PRs in one push are labeled, the highest level wins.
  - `version/patch`: fix or chore.
  - `version/minor`: new feature, backward-compatible.
  - `version/major`: breaking change.
  - no label: docs/CI-only or not worth a release (ships `:nightly`, which production ignores).
- **Manual steps go under `## Deploy actions` in the PR description**: a new or changed env var, a Pocket ID change, data to fix, anything the server can't do by just pulling the image and restarting (Alembic migrations run on start). The release job copies these sections into the release notes, and the deployer holds any release whose notes contain that heading until a human does the steps. Omit the heading entirely when there is nothing to do; don't write "None".
- Don't hand-create releases or tags; the workflow does it.

## Data

`data/reference/` is a committed snapshot (`scripts/fetch_sgfoodid.py`, `scripts/fetch_usda.py`). SG FoodID nutrients are per 100 g of the edible part and drinks treat 1 ml as 1 g. Its licence requires the attribution notice shown on the Settings page (text in `manifest.json`). `aliases.json` maps hawker shorthand to reference foods; a name that no longer exists logs a warning at load.

Keep README.md, this file and evals/README.md current when behaviour changes. The repo is public: no real names, emails, hostnames, meals or photos in commits; use `example.com` and made-up data.
