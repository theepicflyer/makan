# Agent evals

These evals check the makan assistant on the jobs it does every day. Each case starts from a fresh copy of the food database, seeds whatever household foods and log entries the case needs, and sends one or two messages through the real agent loop (`makan.agent.runner.run_turn`) against the live API. It is then graded on what ended up in the database: the right foods, meals, dates and portions; household foods used, or left alone, as asked; no duplicate entries. Grading never reads the reply text, except in the one case that asks a question.

There are 33 cases (`cases.py`):

- **Text (20):** end-of-day dumps in hawker shorthand and Singlish ("teh c siew dai", "milo peng", "supper ice kachang"), counts and weights, two days in one message, household defaults ("a bowl of yogurt" means the household yogurt; "Fage greek yogurt" doesn't), teaching a portion, follow-up corrections, moving and deleting entries, editing yesterday, copying yesterday's breakfast, and a question that must not change anything.
- **Labels (3):** a CP chicken rib bag whose label rows are printed out of line with their values, a FairPrice oat milk carton saved and logged in one message, and a switch to a second oat milk, which has to take over the "oat milk" alias without overwriting the first.
- **Meal photos (10):** your own photos (`evals/photos/`, gitignored), including bak kut teh, dry prawn mee, nasi lemak with wings, nasi padang, wanton mee, curry rice, risotto, tacos and onigiri. The reference calorie total for each one is Claude's estimate (Opus 5.5, in Claude Code) from looking at the photo, with a tolerance of roughly ±30%. Meal photos are graded on their main components and the day total, not on how many entries they were split into.

## Results (2026-10-21)

| model, effort | runs | pass | text | photos | $ per message | p50 latency |
|---|---|---|---|---|---|---|
| Haiku 5.5, low | 33×2 | 98% | 100% | 96% | $0.0008 | 5.7 s |
| Haiku 5.5, medium | 33×2 | 98% | 100% | 96% | $0.0008 | 5.6 s |
| Haiku 5.5, high | 33×2 | 98% | 100% | 96% | $0.0009 | 6.1 s |
| Haiku 5.5, low, no prompt caching | 33×1 | 94% | 100% | 85% | $0.0020 | 5.7 s |
| Opus 5.5, low (text cases only) | 20×1 | 100% | 100% | — | $0.0180 | 7.0 s |

**The default is Haiku 5.5 at low effort.** It passed every text case. Higher effort bought nothing measurable. Opus 5.5 was also perfect on text but cost about 36 times as much ($0.018 against $0.0005 per text message). Photo messages cost more than text: about $0.0012 each on Haiku.

**Prompt caching cuts cost by about 60%** ($0.0020 down to $0.0008 per message). The system prompt and tools are cached across both users, and each conversation's history is cached turn to turn, so about 85% of input tokens are read from the cache. A text message takes about three API calls: search, log, then reply.

**Remaining misses** are all photo portion judgements. "lunch, I had 2 of these" under a photo of four different onigiri was sometimes read as two of each. Curry rice and home-cooked pork ribs occasionally landed just outside the reference band.

The first round (before the prompt changes in this branch) passed 77–85% on Haiku. The prompt fixes that closed the gap:

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

Every run makes real API calls. Haiku costs about $0.03 for the full 33 cases and Opus about $0.40 for the text cases. Results go to `evals/results/<name>/`, which is gitignored: `results.jsonl` holds one graded row per case and repeat, `traces/` holds the full transcripts, and `dbs/` holds each case's final database, which is what `--regrade` reads. A finished (case, repeat) is skipped when you rerun, so a crashed run resumes where it stopped.
