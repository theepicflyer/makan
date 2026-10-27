# Agent evals

These evals check the makan assistant on the jobs it does every day. Each case starts from a fresh copy of the food database, seeds whatever household foods and log entries the case needs, and sends one or two messages through the real agent loop (`makan.agent.runner.run_turn`) against the live API. It is then graded on what ended up in the database: the right foods, meals, dates and portions; household foods used, or left alone, as asked; no duplicate entries. Grading never reads the reply text, except in the one case that asks a question.

There are 57 cases (`cases.py`):

- Text (23): end-of-day dumps in hawker shorthand and Singlish ("teh c siew dai", "milo peng", "supper ice kachang"), counts and weights, two days in one message, household defaults ("a bowl of yogurt" means the household yogurt; "Fage greek yogurt" doesn't), teaching a portion, follow-up corrections, moving and deleting entries, editing yesterday, copying yesterday's breakfast, a dish the database lacks ("unagi fried rice" must count the eel, not log plain egg fried rice; "onsen eggs" must be estimated under that name, not logged as another egg dish), a qualifier the search must keep ("soft boiled" eggs, not hard-boiled), and a question that must not change anything.
- Labels (3): a CP chicken rib bag whose label rows are printed out of line with their values, a FairPrice oat milk carton saved and logged in one message, and a switch to a second oat milk, which has to take over the "oat milk" alias without overwriting the first.
- Add, then edit (10): the first message logs something and the second changes it. The cases fix one portion out of several items, swap steamed for roasted chicken rice, set the meal afterwards, remove one item, move the entry to yesterday, switch teh c to siew dai, drop the you tiao from a bak kut teh photo, halve the rice on a nasi lemak photo, and change the serving on a just-saved label. One more checks that "and another kopi c at 3pm" adds a second entry instead of editing the first. An edit has to change the entry that already exists; deleting it and logging it again fails.
- Meal photos (21): your own photos (`evals/photos/`, gitignored), including bak kut teh, dry prawn mee, nasi lemak with wings, nasi padang, wanton mee, curry rice, risotto, tacos and onigiri. Eleven more are mixed plates with several parts, many of which have no matching database food: three-roast rice, economy bee hoon, a Sri Lankan rice and curry plate, nabeyaki udon with tempura, zha jiang mian with sides, pineapple fried rice with kangkong, curry cutlet rice, a buffet plate, home-cooked instant noodles with fishcake, and two nasi lemak. Some messages add a share or an exclusion ("the wings were shared 3 ways", "shared this, I had half", "the bowl wasn't mine"). The reference calorie total for each one is Claude's estimate (Opus 5.5, in Claude Code) from looking at the photo, with a tolerance of roughly ±30%. Meal photos are graded on their main components and the day total, not on how many entries they were split into.

## Results (2026-10-21)

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

## Running

```bash
uv run python -m evals.run --model claude-haiku-5-5 --effort low --reps 2       # all cases
uv run python -m evals.run --model claude-opus-5-5 --effort low --tags text     # text cases only
uv run python -m evals.run --cases photo_tacos,label_chicken_rib --name scratch  # a few cases
uv run python -m evals.run --no-cache --name haiku-low-nocache                  # caching off
uv run python -m evals.run --name haiku-5-5-low --regrade                       # re-grade saved runs, no API calls
uv run python -m evals.report                                                    # writes results/summary.md
```

Every run makes real API calls. Haiku costs about $0.04 for the full 44 cases and Opus about $0.50 for the text cases. Results go to `evals/results/<name>/`, which is gitignored: `results.jsonl` holds one graded row per case and repeat, `traces/` holds the full transcripts, and `dbs/` holds each case's final database, which is what `--regrade` reads. A finished (case, repeat) is skipped when you rerun, so a crashed run resumes where it stopped.
