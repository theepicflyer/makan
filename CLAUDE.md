# CLAUDE.md

Guidance for working in this repository.

## Project

Bao is a calorie and macro tracker for a two-person household, built on [Warren](https://github.com/theepicflyer/warren), the household's shared framework: one container, one Node process, one SQLite file, one origin. `server/` is Bao itself (TypeScript): its tables, rules, API, the Claude agent's prompt and tools, and the read-only tools for MCP clients. `web/` is the SvelteKit PWA the server serves. Warren provides the rest: sign-in, the agent loop, undo, the MCP server and its OAuth proxy, Web Push, the scheduler, snapshots.

Read Warren's CLAUDE.md before changing anything about how the agent runs, how sign-in or MCP works, or what is backed up; those rules live there and its tests enforce them.

## Commands

```bash
cd server && npm ci
npm run check                          # tsc
npm test                               # no network; a scripted Claude (test/helpers.ts)
npm run dev                            # the server on :8000 with a name picker instead of Pocket ID
npm run db:generate                    # after editing src/schema.ts
npm run evals -- --dry-run             # check and seed every eval case, free
npm run evals -- --model claude-haiku-5-5 --effort low --reps 2   # paid: real API calls
npm run evals:report                   # writes evals/results/summary.md
cd web && npm run check && npm run build        # the web app; the server serves web/build
```

Evals cost real money (Haiku is ~$0.001/case, Opus ~$0.03/case). Run a subset with `--cases` or `--tags` while iterating. Cases from real use, including every photo case, are in `server/evals/prodCases.ts` with photos in `evals/photos/` (see `evals/README.md`).

## Architecture

All paths are under `server/src/`.

- `app.ts`: `createBao` hands Warren's `createApp` everything Bao is. `main.ts` starts it.
- `schema.ts`: Bao's tables. Property names are the column names (snake_case), so a row is also its API shape. People, threads, turns, changes, files and push subscriptions are Warren's tables (`warren_*`); a person's Bao settings are in `profiles`.
- `foods.ts`: reference loading (stable ids across reloads), FTS5 search with source boosts (Ours > SG FoodID > USDA), alias matches (marked in the agent's search results as a known name for the query), hawker spelling variants, USDA de-duplication; portions (`resolvePortion`) and the editable household ("ours") foods. An alias belongs to one household food; saving it on another moves it. The search index (`food_fts`) is kept by SQL triggers on `foods` (first migration), so undo and reference reloads need no index code.
- `log.ts`: entries store nutrient totals copied at log time, so editing a food never rewrites history, and an entry outlives its food (`ON DELETE SET NULL`). Domain functions take an optional `ChangeLog`; the agent's tools pass the turn's, so a whole turn can be undone. Hand edits and deletes through the API (`byHand`) of entries with `origin == "agent"` go to `entry_edits` for auditing; undo never sees them.
- `dates.ts`: days are `YYYY-MM-DD` strings in the household's timezone. Before 04:00 "today" is still the previous day (`logDay`).
- `agent/systemPrompt.ts` (frozen text), `agent/context.ts` (the per-turn context: today, yesterday and the log date, today's entries as well when the app is on another day, and after midnight which day "today" means; the household food list once per thread and again when it changes), `agent/tools.ts` (the agent's 7 tools with compact text results, and 5 read-only tools for MCP clients). A thread's `scope` is the log date: the web app starts a thread when Bao's sheet opens and sends its id back until the sheet closes or the date changes. The sheet also shows the day's earlier turns from every thread, for display only.
- `reminders.ts`: daily reminders. A job on Warren's scheduler checks once a minute; each person has one `reminder_time`; a day with breakfast, lunch and dinner logged gets no reminder, and `reminded_on` keeps it to one a day.
- `api.ts`: the web app's JSON API under `/api`. A `DomainError` is a 400 with its message.
- `importLegacy.ts`: one-off import of a database from the Python version (`makan.db`). `exportFlagged.ts`: bundles thumbs-down, failed and hand-corrected turns for review.
- `server/evals/`: the eval cases, runner, grader and report.
- `web/src/lib/burrow/`: the Burrow design system (the household's shared look). `tokens.css`, `burrow.css` and `art.js` are copies of the design system's files; re-sync them rather than editing. The Svelte components next to them are thin markup over Burrow's classes. `web/README.md` has the rules for new screens. Every fact has a place (Burrow's "Where information goes"): Tags, dated `bh-when`, card subtitles and footers, never facts joined with " · ".
- `web/` is phone first. From 640px (Tailwind `sm`, `columns` in `state.svelte.ts`: unfolded foldables and tablets) screens lay out in columns under the phone's docked nav and Bao's round message button; from 1024px (`lg`, `wide`) a side rail (`SideNav`) replaces the bottom nav and the message button moves into Today's left column. The composer exists only inside Bao's sheet. Half-folded in book posture (Viewport Segments API; the `book:` variant, `book` in `state.svelte.ts`) the columns split either side of the fold and fixed things keep to its left. Fixed elements place themselves with `--rail-w`, `--dock-h`, `--message-h` and `--fold-right` from `layout.css`; sheets size with `--sheet-h`. Charts are built on `BarChart.svelte`; History's sums and averages live in `lib/history.ts`. Energy, protein, carbs and fat are always marked with `NutrientIcon` (flame, drumstick, wheat, drop), never letters or colour dots.
- Motion: everything in the web app animates, and nothing does under `prefers-reduced-motion: reduce`. Entrances on first render are CSS in the motion section of `layout.css`; things added, removed or swapped later use the wrappers in `lib/motion.ts` (Svelte's own transitions ignore reduced motion); numbers count with `Count.svelte`; screens change with a view transition (`onNavigate` in `+layout.svelte`), except one day to another, which slides inside the day page.
- Any page address that isn't a file, `/api`, `/auth`, `/oauth`, `/mcp` or `/.well-known` is served the web app's shell, so new client-side routes need no server change.

## Rules that keep the agent cheap and correct

Warren's runner enforces these and its tests assert them; Bao's part is not to break them.

- **The system prompt is frozen text.** Never interpolate dates, names or data into `SYSTEM_PROMPT`; per-turn context goes into the user message (`buildContext`). This keeps the cached prefix byte-identical across people and turns.
- **Tool definitions are part of that prefix.** A change to a tool's schema or description changes what the model sees and resets the cache for everyone; run the evals after one.
- **History is append-only.** Never edit a stored turn's messages.
- Check `cache_read` in a turn's stored usage after any change to the prompt, context or tools.

## Releases and deploy

Images go to `ghcr.io/theepicflyer/bao` (the name follows the GitHub repo). Two workflows plus a reusable build:

- `ci.yml`: the server's type check and tests and the web app's `npm run check` on every PR; also called by `release.yml`.
- `release.yml`: on every push to `main`, runs the tests, then `.github/scripts/plan-release.sh` looks at the PRs that push merged. If any carries a `version/*` label it bumps from the latest GitHub release, pushes `:X.Y.Z` + `:latest`, then creates the release **last** (so a release never points at a missing image). No label: it pushes `:nightly` only. `workflow_dispatch` builds a one-off `:<tag>` from any ref.
- `build-push.yml`: the one place the Docker build lives (amd64). The image's `org.opencontainers.image.revision` label is the commit it was built from.

Warren is pinned to a commit in `server/package.json`. To take a Warren change, bump the pin, run the tests, and release Bao.

### Shipping a change

A release is how work reaches production: the production server polls for new releases, has each one security-reviewed by an agent, and deploys it. So:

- **One PR per piece of work.** If it is too big for one PR, stack PRs with `gh stack` (`gh extension install github/gh-stack`; `gh stack init`, `gh stack add`, `gh stack submit`) and merge the stack together.
- **Exactly one `version/*` label per release**, on the single PR or on the **top** PR of a stack. Leave the lower PRs of a stack unlabeled; one push merging the stack makes one release. If several PRs in one push are labeled, the highest level wins.
  - `version/patch`: fix or chore.
  - `version/minor`: new feature, backward-compatible.
  - `version/major`: breaking change.
  - no label: docs/CI-only or not worth a release (ships `:nightly`, which production ignores).
- **Manual steps go under `## Deploy actions` in the PR description**: a new or changed env var, a Pocket ID change, data to fix, anything the server can't do by just pulling the image and restarting (migrations run on start). The release job copies these sections into the release notes, and the deployer holds any release whose notes contain that heading until a human does the steps. Omit the heading entirely when there is nothing to do; don't write "None".
- Don't hand-create releases or tags; the workflow does it.

## Data

`data/reference/` is a committed snapshot (`scripts/fetch_sgfoodid.py`, `scripts/fetch_usda.py`: standalone Python, run with `uv run --no-project`, the only Python left). SG FoodID nutrients are per 100 g of the edible part and drinks treat 1 ml as 1 g. Its licence requires the attribution notice shown on the Settings page (text in `manifest.json`). `aliases.json` maps hawker shorthand to reference foods; a name that no longer exists logs a warning at load.

Keep README.md, this file and evals/README.md current when behaviour changes. The repo is public: no real names, emails or hostnames in commits; use `example.com` and made-up data. The one exception is the eval cases from real use (`server/evals/prodCases.ts`, `evals/photos/`): each was vetted by the household before it went in, so add new ones only after the same review.
