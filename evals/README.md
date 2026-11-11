# Agent evals

These evals check the Bao assistant on the jobs it does every day. Each case starts from a fresh copy of the food database, seeds whatever household foods and log entries the case needs, and sends one or more messages through the real agent loop (`bao.agent.runner.run_turn`) against the live API. It is then graded on what ended up in the database: the right foods, meals, dates and portions; household foods used, or left alone, as asked; no duplicate entries. Grading reads the reply text only for the case that asks a question and for cases with `reply_forbid`.

## Cases

There are 91 cases, all in the repo. `cases.py` holds 45 made-up text cases; `prod_cases.py` holds 46 taken from real use, including every photo case (see below). `spec.py` defines the case format.

- Text (23): end-of-day dumps in hawker shorthand and Singlish ("teh c siew dai", "milo peng", "supper ice kachang"), counts and weights, two days in one message, household defaults ("a bowl of yogurt" means the household yogurt; "Fage greek yogurt" doesn't), teaching a portion, follow-up corrections, moving and deleting entries, editing yesterday, copying yesterday's breakfast, a dish the database lacks ("unagi fried rice" must count the eel, not log plain egg fried rice; "onsen eggs" must be estimated under that name, not logged as another egg dish), a qualifier the search must keep ("soft boiled" eggs, not hard-boiled), and a question that must not change anything.
- Add, then edit (7): the first message logs something and the second changes it. The cases fix one portion out of several items, swap steamed for roasted chicken rice, set the meal afterwards, remove one item, move the entry to yesterday and switch teh c to siew dai. One more checks that "and another kopi c at 3pm" adds a second entry instead of editing the first. An edit has to change the entry that already exists; deleting it and logging it again fails.
- Regressions (15, tagged `regression`): failure patterns seen in real use, rewritten with made-up meals. "Yesterday" when the app is already on yesterday must not go back two days, and "today" must land on today when the app is on a stale date (`stale_date`). "It was a very big portion" must raise the portion (`portion`). "Split into 4 portions, I had one" must quarter the dishes, both as a follow-up edit and in one message (`split`). "Save today's lunch as X" must save one household food whose default serving matches the logged meal, without logging anything new (`save_as`). Searches that put the wrong food first must not win: a household chicken rib for "beef short ribs", poke bowls for "tau pok", collard greens for "pork collar", prawn dishes for "prawns" (`search`). A near-name food must not stand in for a different dish: prawn noodles for fried hokkien mee, white rice for roasted chicken rice, carrot cake the dessert for fried carrot cake (`near_name`). A stated amount beats the default serving: half a bowl of nasi goreng is not half the 485 g plate, a small thin slice of chocolate cake is not the 116 g slice (`default_serving`).

### Cases from real use

`prod_cases.py` is the photo benchmark. Every photo sent to Bao in its first weeks is a case (several photos in one message stay one case), with the real wording, the household foods that existed at the time and the log entries the message referred to. The photos are in `photos/`. Text turns the agent got wrong are cases too. Dates are shifted by five weeks, so weekdays still match the wording ("on Friday too").

Turns the agent got wrong are tagged `regression`, ones it got right `baseline`, so a change that fixes failures but breaks what worked shows up. Meal photos (29) are tagged `photo` and `meal` and are graded on their main components and the meal or day total, not on how many entries they were split into. The reference total is a reviewer's estimate from the photo, with a tolerance of about ±30% (tighter where the agent's wrong answer fell inside 30%). Label photos (5) are tagged `photo` and `label` and are checked against the label's values. The 12 text cases are tagged `text` and `regression`. Pattern tags match the made-up regressions, plus `photo_count`, `misidentified`, `protein_undersized`, `small_portion`, `shared`, `instruction`, `ours_outranks`, `tool_calls` and `tool_errors`.

A run stops before any API call if a photo named by a selected case is missing from `photos/`.

### Case fields

Most checks are on `Case.expect`, a list of `Item`s (a regex on the entry name, plus meal, date, kcal range, household food), matched one-to-one to the entries on `check_dates`. Others:

- `now` and `log_date` are separate, as in the app: `log_date` is the day the app shows, `now` the time the message is sent.
- `entries` seeds the log: a tuple `(date, meal, "sg:Name" | "usda:Name" | "ours:key", servings)`, or a dict with `date`, `meal` and either `ref` (plus `servings`, `serving`, `grams`, `name`) or `name` with `kcal`, `protein_g`, `carb_g`, `fat_g` for an estimate.
- `Msg.photos`: several photos in one message.
- `total_kcal` with `total_date` (default `log_date`) and `total_meal` (default all meals); `ref_kcal` is the reference for the `kcal_err` metric on the same total.
- `total_drop`: how far the log date's total must fall from the first message to the end; a negative range means it must rise.
- `forbid`: regexes no entry on the checked dates may match.
- `FoodCheck.serving_kcal`: kcal range for a household food's default serving.
- `max_tool_calls`, `max_tool_errors`: limits over the whole case (tool errors are invalid or failed calls).
- `reply_forbid`: regexes the last reply must not match (e.g. restated calories).

## Baseline on the current set (2026-11-10)

All 91 cases, low effort, prompt and tools as released in 2.1.0. Haiku and Sonnet ran twice, Opus once. These runs were made before the cases from real use moved into the repo (with two photo cases removed and dates shifted); the numbers are recomputed from the same runs without the two removed cases.

| model | pass | earlier text cases (30) | regression cases (46) | baseline photo cases (15) | all photo cases (34) | photo kcal error (median) | $ per case |
|---|---|---|---|---|---|---|---|
| Haiku 5.5 | 66% ± 7% | 97% | 43% | 73% | 51% | 21% | $0.0009 |
| Sonnet 5.5 | 81% ± 6% | 100% | 67% | 83% | 68% | 18% | $0.0135 |
| Opus 5.5 | 88% ± 7% | 100% | 80% | 87% | 76% | 11% | $0.0267 |

Replies finish in about the same time on all three (first message p50 3.4 s to 4.5 s, photo message 7 s to 9 s). Seven cases fail on every model: small home portions logged at a standard serving (a cheesecake slice, pancakes and bacon), a piece count read from a photo, a photo logged while the app is on an older date, a shared table, a per-item split and a chain bakery's bun.

## Results (2026-10-21)

These results and the photo-portion results below are historical: they were measured on the previous case set, which had 21 meal and 6 label photo cases that are no longer in the suite. The photo benchmark is now the cases from real use above.


| model, effort | runs | pass | text | photos | add then edit | $ per message |
|---|---|---|---|---|---|---|
| Haiku 5.5, low | 43×2 | 97% | 98% | 94% | 100% | $0.0006 |
| Haiku 5.5, medium | 43×2 | 97% | 100% | 91% | 100% | $0.0006 |
| Haiku 5.5, high | 43×2 | 97% | 100% | 91% | 100% | $0.0007 |
| Haiku 5.5, low, no prompt caching | 43×1 | 98% | 96% | 100% | 100% | $0.0018 |
| Opus 5.5, low (text cases only) | 27×1 | 100% | 100% | n/a | 100% | $0.0138 |

Wall time per message, in seconds, from sending to the log changing on screen and to the reply finishing:

| model, effort | first message: log changes | first message: reply done (p50 / p90) | follow-up edit: log changes | follow-up edit: reply done (p50 / p90) | photo message: reply done |
|---|---|---|---|---|---|
| Haiku 5.5, low | 3.0 | 4.3 / 6.1 | 1.4 | 2.5 / 6.8 | 7.0 |
| Haiku 5.5, medium | 3.0 | 4.4 / 6.1 | 1.4 | 2.6 / 6.1 | 7.6 |
| Haiku 5.5, high | 3.2 | 4.5 / 9.0 | 1.3 | 2.5 / 8.6 | 8.6 |
| Opus 5.5, low | 3.9 | 6.3 / 9.5 | 2.0 | 3.7 / 5.3 | n/a |

The default is Haiku 5.5 at low effort. Higher effort bought no accuracy and made the slowest messages slower. Opus 5.5 was perfect on the text cases but took about 2 s longer per first message and cost about 35 times as much per text message ($0.0138 against $0.0004). On Haiku a photo message costs about $0.0010.

Follow-up edits are quick because the context already lists the day's entries with their ids, so the assistant can usually change an entry in one call without searching. Every edit case passed on every model and effort.

Prompt caching cuts cost by about two thirds, from $0.0018 to $0.0006 per message. The system prompt and tools are cached across both users, and each conversation's history is cached from one turn to the next, so about 90% of input tokens are read from the cache. A message takes about 2.7 API calls on average. A first message usually searches, logs, then replies.

The remaining misses are mostly photo portion judgements. "lunch, I had 2 of these" under a photo of four different onigiri is still often read as two of each. Single runs also logged a Fage cup at 141 kcal (just under the band), read "black coffee" as kopi O, and put a large prawn mee below the reference band.

The first round, before the prompt changes in this branch, passed 77 to 85% on Haiku. These prompt fixes closed the gap:

- Treat messages about already-logged food as edits. Before this, "I only finished half the laksa" added a second half-portion entry.
- Log the most likely reading and state the assumption instead of asking which items were eaten.
- Put follow-ups in the same meal as the item they follow.
- Create a new household food for a new product instead of overwriting the old one.

### Photo portions (2026-10-27)

The prompt now has Bao work out each photo component's grams before it picks a food: size from the plate, bowl, cutlery and piece counts, plus what the photo hides (rice under toppings, oil, gravy). A linked food takes the grams seen instead of its default serving, and a database set counts as the same food only when the photo shows the same components. Haiku 5.5 at low effort, all 27 photo cases, 2 reps each, before and after:

| | pass | meal total, mean error vs reference | entries with grams |
|---|---|---|---|
| before | 51/54 | 13.9% | 65% |
| after | 53/54 | 11.9% | 75% |

Cost and time per message didn't change. The change mostly helped plates the database has as a set with different components. A nasi lemak with curry-leaf chicken was logged as the database's chicken wing set (998 and 1249 kcal against a reference of 1550) and is now split into rice and an estimate for the chicken (1491 and 1275). Every linked food in the after run carries grams; the entries without grams are all estimates. With two reps per case, these differences are within noise for any single case. The text, label and edit cases all still pass.

## Running

```bash
uv run python -m evals.run --dry-run                                            # check and seed every case, no API calls
uv run python -m evals.run --model claude-haiku-5-5 --effort low --reps 2       # all cases
uv run python -m evals.run --model claude-opus-5-5 --effort low --tags text     # text cases only
uv run python -m evals.run --tags regression --name haiku-regressions           # every regression case
uv run python -m evals.run --tags photo --name haiku-photos                      # the photo benchmark
uv run python -m evals.run --tags baseline                                      # what worked in production
uv run python -m evals.run --cases reg_tau_pok_not_poke,reg_small_slice --name scratch  # a few cases
uv run python -m evals.run --no-cache --name haiku-low-nocache                  # caching off
uv run python -m evals.run --name haiku-5-5-low --regrade                       # re-grade saved runs, no API calls
uv run python -m evals.report                                                    # writes results/summary.md
```

`--tags` runs a case if it has any of the listed tags. `--dry-run` checks every selected case (regexes compile, photo files exist, expected dates are checked, household food keys exist), seeds it into a scratch database and grades the seeded state, so a broken food reference or seed fails without spending anything. Every other run makes real API calls. Results go to `evals/results/<name>/`, which is gitignored: `results.jsonl` holds one graded row per case and repeat, `traces/` holds the full transcripts, and `dbs/` holds each case's final database, which is what `--regrade` reads. A finished (case, repeat) is skipped when you rerun, so a crashed run resumes where it stopped.
