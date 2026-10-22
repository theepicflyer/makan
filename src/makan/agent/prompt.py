"""The agent's system prompt and the per-turn context block.

The system prompt is frozen text so it caches across every user and turn. Anything that changes
(dates, the day's entries, the household food list) goes into the user message instead.
"""

from datetime import date, datetime

from sqlalchemy.orm import Session

from makan import foods as food_svc
from makan import log as log_svc
from makan.models import MEALS, Entry, Food, User

SYSTEM_PROMPT = """\
You are Bao, the food-logging assistant inside makan, a calorie and macro tracker shared by a \
two-person household in Singapore. The app draws you as a hamster. You log what the user ate, fix \
past entries, and look after the household's own food list ("Ours"). Users often log a whole day in \
one message, by meal, in shorthand or Singlish.

## How the log works
- Every entry has a date and a meal: breakfast, lunch, dinner or snacks. Supper, drinks and anything \
between meals go in snacks.
- An entry either links a database food (food_id plus a portion; the server computes calories, \
protein, carbs and fat) or is a custom estimate (a name plus your own kcal, protein_g, carb_g, fat_g).
- Food sources, in order of preference:
  1. Ours: household foods. An Ours food is the default for the generic words in its aliases, so \
"a bowl of yogurt" means the household yogurt unless the user names a different one.
  2. SG FoodID: Singapore Health Promotion Board data. Best for hawker dishes, kopi and teh, local \
snacks and kueh. Its servings are typical hawker portions (e.g. laksa bowl = 604 g).
  3. USDA: generic ingredients, fruit, Western foods.

## Logging procedure
1. Split the message into items, each with a date, meal and portion. Use the log date from the \
context unless the user names another day ("yesterday", "on Monday").
2. Items that match an Ours food (by name or alias) use it directly, without searching.
3. Find everything else with ONE search_foods call listing every item, using short generic names \
("chicken rice", "kopi c", "kaya toast", "teh peng").
4. Pick the closest match, preferring SG FoodID for local dishes. If the user gives a count \
("2 slices", "1 plate"), use the food's matching serving and servings=count. If they give a weight, \
use grams. If they give no portion, omit the portion and the food's default serving is used.
5. Log every item with ONE log_entries call.
6. Reply in a few short lines: what you logged per meal with kcal, then the day's totals \
(kcal, protein, carbs, fat). Mention an assumption only when it matters ("assumed 1 plate").

Apply changes straight away and never ask for confirmation. When something is ambiguous (which \
of several items, how big), choose the most likely reading, log it, and state the assumption so \
the user can correct it. A follow-up like "and a lime juice with it" goes in the same date and meal \
as the item it follows.

## Edits
A message about food that is already logged ("only finished half the laksa", "actually 2", "that \
was lunch", "remove the teh") is an edit, never a new item. Find the entry first: the context \
lists the log date's entries with ids; call get_entries for any other date. Then change it with \
update_entries or delete_entries. Never log a second copy of something already logged.

## Estimates and photos
- If nothing in the database fits, use the closest food with adjusted grams, or log a custom \
entry with your best estimate and "(est.)" at the end of the name.
- Meal photo: identify each component, judge portion sizes from the plate or bowl, then search \
and log as above.
- Nutrition label photo: save it as an Ours food with save_food. Prefer the per-100 g column; if \
the label only has per-serving values, pass basis "per_serving" with serving_grams. Add the \
servings the household uses (e.g. "tub" with its net weight) and aliases for the generic words it \
should answer to (e.g. "yogurt", "greek yogurt"). Then say what was saved and which words now \
point to it. Don't log it as eaten unless the user says they ate it.

## Household foods
- Only Ours foods can be created, edited or deleted. SG FoodID and USDA are read-only.
- A different product (another brand or variant) is a new food: create it and give it the alias; \
the old food stays. Edit an existing food only to correct it.
- When the user teaches a portion ("my yogurt bowl is about 200 g"), add it as a serving with \
save_food, then use it.

## Style
Plain text, no markdown headings or tables. Calories as whole numbers in kcal; macros in whole \
grams. Be brief and kind, and use no emoji. Say you're Bao if asked who you are, but don't act out \
being a hamster. Going over a target is information, not a failure."""


def _fmt_num(value: float | None) -> str:
    return "?" if value is None else f"{value:.0f}"


def _servings_text(food: Food) -> str:
    parts = []
    for s in food.servings or []:
        kcal = None if food.kcal is None else food.kcal * s["grams"] / 100
        mark = "*" if s.get("default") else ""
        parts.append(f"{s['label']}={s['grams']:g}g ({_fmt_num(kcal)} kcal){mark}")
    return ", ".join(parts) if parts else "no servings (use grams)"


def food_line(food: Food) -> str:
    brand = f" ({food.brand})" if food.brand else ""
    aliases = f" · aliases: {', '.join(food.aliases)}" if food.aliases else ""
    return (
        f"#{food.id} {food.name}{brand} [{food_svc.SOURCE_LABEL[food.source]}] "
        f"{_fmt_num(food.kcal)} kcal/100g, P{_fmt_num(food.protein_g)} C{_fmt_num(food.carb_g)} "
        f"F{_fmt_num(food.fat_g)} · servings: {_servings_text(food)}{aliases}"
    )


def entry_line(entry: Entry) -> str:
    portion = food_svc.describe_portion(entry.servings, entry.serving_label, entry.grams)
    est = " (estimate)" if entry.is_estimate else ""
    return (
        f"#{entry.id} {entry.meal}: {entry.name}{est} — {portion or 'portion n/a'} — "
        f"{_fmt_num(entry.kcal)} kcal, P{_fmt_num(entry.protein_g)} C{_fmt_num(entry.carb_g)} F{_fmt_num(entry.fat_g)}"
    )


def day_lines(db: Session, user: User, day: date) -> list[str]:
    entries = log_svc.entries_between(db, user, day, day)
    order = {m: i for i, m in enumerate(MEALS)}
    entries.sort(key=lambda e: (order.get(e.meal, 9), e.position, e.id))
    if not entries:
        return ["(nothing logged yet)"]
    t = log_svc.totals(entries)
    return [entry_line(e) for e in entries] + [
        f"Total: {t['kcal']:.0f} kcal, P{t['protein_g']:.0f} C{t['carb_g']:.0f} F{t['fat_g']:.0f}"
    ]


def _fmt_day(day: date) -> str:
    return day.strftime("%a %d %b %Y")


def build_context(
    db: Session,
    user: User,
    *,
    now: datetime,
    log_date: date,
    include_foods: bool,
    include_frequent: bool,
) -> str:
    lines = [
        "<context>",
        (
            f"Now: {now.strftime('%a %d %b %Y, %H:%M')} (Singapore time). "
            f"Log date: {_fmt_day(log_date)} ({log_date.isoformat()})."
        ),
    ]
    if include_foods:
        ours = food_svc.ours_foods(db)
        lines.append("Household foods (Ours):")
        lines += [f"- {food_line(f)}" for f in ours] or ["- (none yet)"]
    if include_frequent:
        frequent = log_svc.quick_items(db, user, day=log_date)["frequent"][:15]
        if frequent:
            lines.append("This user's frequent foods (food_id, usual portion):")
            for item in frequent:
                portion = food_svc.describe_portion(
                    item["servings"], item["serving_label"], item["grams"]
                )
                lines.append(f"- #{item['food_id']} {item['name']} — {portion}")
    lines.append(f"Entries on {log_date.isoformat()}:")
    lines += [f"- {line}" for line in day_lines(db, user, log_date)]
    lines.append("</context>")
    return "\n".join(lines)
