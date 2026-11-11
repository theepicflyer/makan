"""The case format: messages, expected entries and household foods, and the default dates."""

from dataclasses import dataclass, field

TODAY = "2026-10-21"
YESTERDAY = "2026-10-20"
DAY_BEFORE = "2026-10-19"
EVENING = "2026-10-21T21:30"
MORNING = "2026-10-21T09:40"


@dataclass
class Msg:
    text: str
    photo: str | None = None
    photos: list[str] = field(default_factory=list)  # several photos in one message, in order

    def all_photos(self) -> list[str]:
        return ([self.photo] if self.photo else []) + self.photos


@dataclass
class Item:
    """An entry expected in the log after the case. `name` is a regex on the entry name."""

    name: str
    meal: str | None = None
    date: str | None = None  # defaults to the case's log date
    kcal: tuple[float, float] | None = None
    ours: str | None = None
    not_ours: str | None = None
    optional: bool = False
    # Must be an entry that already existed after the first message (edited in place, not re-added).
    from_first_turn: bool = False


@dataclass
class FoodCheck:
    """A household food expected after the case. Ranges are per 100 g."""

    name: str
    kcal: tuple[float, float] | None = None
    protein_g: tuple[float, float] | None = None
    carb_g: tuple[float, float] | None = None
    fat_g: tuple[float, float] | None = None
    serving_grams: list[tuple[float, float]] | None = (
        None  # at least one serving in one of these ranges
    )
    aliases_include: list[str] = field(default_factory=list)
    aliases_exclude: list[str] = field(default_factory=list)
    serving_kcal: tuple[float, float] | None = None  # kcal of the default serving


@dataclass
class Case:
    id: str
    tags: list[str]
    msgs: list[Msg]
    now: str = EVENING
    log_date: str = TODAY
    ours: list[dict] = field(default_factory=list)
    # (date, meal, food ref "sg:Name" | "usda:Name" | "ours:key", servings or None), or a dict
    # with date, meal and either ref (plus servings/serving/grams/name) or name plus kcal and macros.
    entries: list[tuple | dict] = field(default_factory=list)
    expect: list[Item] | None = None  # the complete log for the checked dates
    check_dates: list[str] = field(default_factory=lambda: [TODAY])
    total_kcal: tuple[float, float] | None = None  # on total_date
    total_date: str | None = None  # defaults to log_date
    total_meal: str | None = None  # count only this meal in total_kcal and ref_kcal
    ref_kcal: float | None = None  # benchmark estimate for photo cases
    foods: list[FoodCheck] = field(default_factory=list)
    reply_protein: bool = False  # the reply must state the day's protein total
    # How much the log date's kcal total must fall between the first message and the end.
    total_drop: tuple[float, float] | None = None
    forbid: list[str] = field(default_factory=list)  # no entry on the checked dates may match these
    strict_count: bool = (
        True  # False: extra entries are fine (photo meals split into any number of parts)
    )
    max_tool_calls: int | None = None  # over every message of the case
    max_tool_errors: int | None = None  # tool calls rejected as invalid or failed
    reply_forbid: list[str] = field(default_factory=list)  # regexes the last reply must not match
