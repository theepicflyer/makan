"""Eval cases for the Bao logging agent.

Each case seeds a fresh database, sends one or more messages through the real agent loop, and is
graded on what ends up in the database. The cases here are text only and made up. Photo cases use
real meals, so they live outside the repo in `evals/private/` (see README.md) and are added to
CASES when that directory exists.
"""

import importlib.util
from dataclasses import dataclass, field
from pathlib import Path

TODAY = "2026-10-21"
YESTERDAY = "2026-10-20"
DAY_BEFORE = "2026-10-19"
EVENING = "2026-10-21T21:30"
MORNING = "2026-10-21T09:40"
PRIVATE = Path(__file__).parent / "private"

CHOBANI = {
    "key": "chobani",
    "name": "Greek Yogurt Light",
    "brand": "Chobani",
    "nutrients": {"kcal": 63, "protein_g": 10.0, "carb_g": 5.0, "fat_g": 0.0},
    "servings": [{"label": "tub", "grams": 150, "default": True}, {"label": "bowl", "grams": 200}],
    "aliases": ["yogurt", "greek yogurt"],
}
CP_RIB = {
    "key": "rib",
    "name": "Hot & Crispy Chicken Rib",
    "brand": "CP",
    "nutrients": {"kcal": 302, "protein_g": 12.5, "carb_g": 12.0, "fat_g": 22.7},
    "servings": [{"label": "piece", "grams": 20, "default": True}, {"label": "pack", "grams": 350}],
    "aliases": ["chicken rib", "chicken ribs"],
}


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


CASES: list[Case] = [
    # --- end-of-day text dumps ---------------------------------------------------
    Case(
        "dump_hawker_day",
        ["text", "dump"],
        [
            Msg(
                "breakfast kopi c and 2 slices kaya toast. lunch chicken rice. dinner fish soup bee hoon. teh peng in the afternoon"
            )
        ],
        expect=[
            Item(r"kopi c", "breakfast", kcal=(100, 160)),
            Item(r"kaya", "breakfast", kcal=(300, 800)),
            Item(r"chicken rice", "lunch", kcal=(400, 650)),
            Item(r"fish.*bee ?hoon|bee ?hoon.*fish|fish soup", "dinner", kcal=(300, 600)),
            Item(r"iced teh|teh peng", "snacks", kcal=(120, 260)),
        ],
    ),
    Case(
        "dump_three_meals_supper",
        ["text", "dump"],
        [Msg("lunch nasi lemak with chicken wing. dinner bak chor mee dry. supper ice kachang")],
        expect=[
            Item(r"nasi lemak", "lunch", kcal=(600, 1000)),
            Item(r"bak chor mee", "dinner", kcal=(400, 700)),
            Item(r"ice ka(c|ch)ang", "snacks", kcal=(180, 380)),
        ],
    ),
    Case(
        "singlish_drinks",
        ["text", "dump"],
        [Msg("afternoon drinks: kopi o kosong, milo peng, teh c siew dai")],
        expect=[
            Item(r"kopi o kosong", "snacks", kcal=(10, 60)),
            Item(r"milo", "snacks", kcal=(150, 350)),
            Item(r"teh c (siu|siew) dai", "snacks", kcal=(30, 110)),
        ],
    ),
    Case(
        "counts_satay_ketupat",
        ["text", "portion"],
        [Msg("dinner: 10 sticks of chicken satay and half a ketupat")],
        expect=[
            Item(r"satay", "dinner", kcal=(180, 600)),
            Item(r"ketupat", "dinner", kcal=(30, 70)),
            Item(r"sauce|peanut", "dinner", optional=True),
        ],
    ),
    Case(
        "weights_grams",
        ["text", "portion"],
        [Msg("dinner was 200g grilled chicken breast and 150g brown rice")],
        expect=[
            Item(r"chicken", "dinner", kcal=(260, 460)),
            Item(r"brown rice", "dinner", kcal=(150, 240)),
        ],
    ),
    Case(
        "names_what_user_said",
        ["text", "portion"],
        [Msg("breakfast was 3 eggs soft boiled")],
        expect=[Item(r"(?i)soft", "breakfast", kcal=(180, 260))],
        forbid=[r"(?i)hard"],
    ),
    Case(
        "estimate_from_similar_food",
        ["text", "estimate"],
        [Msg("2 onsen eggs for breakfast")],
        expect=[Item(r"(?i)onsen", "breakfast", kcal=(110, 200))],
        forbid=[r"(?i)tart|fu ?yong|sambal"],
    ),
    Case(
        "western_breakfast",
        ["text", "dump"],
        [Msg("breakfast: 2 eggs, toast with butter and a black coffee")],
        expect=[
            Item(r"egg", "breakfast", kcal=(120, 260)),
            Item(r"toast|bread", "breakfast", kcal=(50, 400)),
            Item(r"butter", "breakfast", optional=True),
            Item(r"coffee|kopi", "breakfast", kcal=(0, 60)),
        ],
    ),
    Case(
        "estimate_unlisted_dish",
        ["text", "estimate"],
        [Msg("lunch: mala xiang guo, medium bowl, mostly veg with some luncheon meat")],
        expect=[
            Item(r"mala", "lunch", kcal=(400, 1300)),
            Item(r"luncheon|spam", "lunch", optional=True),
        ],
        total_kcal=(500, 1400),
    ),
    Case(
        "estimate_dish_with_near_miss",
        ["text", "estimate"],
        [Msg("unagi fried rice for lunch")],
        expect=[Item(r"unagi|eel", "lunch")],
        strict_count=False,
        total_kcal=(650, 1200),
    ),
    Case(
        "two_days_one_message",
        ["text", "dates"],
        [Msg("yesterday dinner was hokkien mee. today lunch was yong tau foo soup, 7 pieces")],
        check_dates=[TODAY, YESTERDAY],
        expect=[
            Item(r"hokkien", "dinner", date=YESTERDAY, kcal=(550, 1000)),
            Item(r"yong tau foo", "lunch", kcal=(150, 600)),
        ],
    ),
    Case(
        "yesterday_breakfast",
        ["text", "dates"],
        [Msg("yesterday breakfast I had 2 roti prata with curry and a teh tarik")],
        check_dates=[TODAY, YESTERDAY],
        expect=[
            Item(r"prata", "breakfast", date=YESTERDAY, kcal=(350, 1050)),
            Item(r"curry", "breakfast", date=YESTERDAY, optional=True),
            Item(r"teh tarik", "breakfast", date=YESTERDAY, kcal=(50, 200)),
        ],
    ),
    # --- household foods as defaults -------------------------------------------
    Case(
        "ours_bowl_of_yogurt",
        ["text", "ours"],
        [Msg("had a bowl of yogurt with a banana for breakfast")],
        ours=[CHOBANI],
        expect=[
            Item(r"yogurt", "breakfast", kcal=(120, 135), ours="chobani"),
            Item(r"banana", "breakfast", kcal=(60, 130)),
        ],
    ),
    Case(
        "ours_overridden_by_brand",
        ["text", "ours"],
        [Msg("breakfast: a cup of Fage full fat greek yogurt at the hotel")],
        ours=[CHOBANI],
        expect=[Item(r"yog|fage", "breakfast", kcal=(150, 330), not_ours="chobani")],
    ),
    Case(
        "ours_pieces",
        ["text", "ours"],
        [Msg("dinner: 6 pieces of the chicken rib with a bowl of rice")],
        ours=[CP_RIB],
        expect=[
            Item(r"rib", "dinner", kcal=(355, 370), ours="rib"),
            Item(r"rice", "dinner", kcal=(200, 340)),
        ],
    ),
    Case(
        "teach_serving",
        ["text", "ours"],
        [Msg("fyi my yogurt bowl is about 250g, not 200")],
        ours=[CHOBANI],
        expect=[],
        foods=[FoodCheck(r"yogurt", serving_grams=[(245, 255)], aliases_include=["yogurt"])],
    ),
    # --- corrections and edits ---------------------------------------------------
    Case(
        "followup_portion",
        ["text", "edit", "multi_turn"],
        [Msg("lunch char kway teow"), Msg("actually it was a large plate, make it 1.5")],
        expect=[Item(r"char kway teow", "lunch", kcal=(1300, 1600))],
    ),
    Case(
        "followup_add",
        ["text", "multi_turn"],
        [Msg("lunch: chicken rice"), Msg("oh and a lime juice with it")],
        expect=[
            Item(r"chicken rice", "lunch", kcal=(400, 650)),
            Item(r"lime", "lunch", kcal=(50, 160)),
        ],
    ),
    Case(
        "move_meal",
        ["text", "edit"],
        [Msg("the kopi was in the afternoon, not breakfast")],
        entries=[
            (TODAY, "breakfast", "sg:Kopi C", None),
            (TODAY, "breakfast", "sg:Kaya and butter toast", None),
        ],
        expect=[
            Item(r"kopi c", "snacks", kcal=(100, 160)),
            Item(r"kaya", "breakfast", kcal=(300, 450)),
        ],
    ),
    Case(
        "edit_yesterday",
        ["text", "edit", "dates"],
        [Msg("yesterday's dinner, I only finished half the laksa")],
        entries=[
            (YESTERDAY, "dinner", "sg:Laksa", None),
            (YESTERDAY, "lunch", "sg:Steamed chicken rice", None),
        ],
        check_dates=[TODAY, YESTERDAY],
        expect=[
            Item(r"laksa", "dinner", date=YESTERDAY, kcal=(190, 230)),
            Item(r"chicken rice", "lunch", date=YESTERDAY, kcal=(400, 650)),
        ],
    ),
    Case(
        "delete_item",
        ["text", "edit"],
        [Msg("remove the teh peng, I didn't have it")],
        entries=[
            (TODAY, "snacks", "sg:Iced Teh", None),
            (TODAY, "lunch", "sg:Steamed chicken rice", None),
        ],
        expect=[Item(r"chicken rice", "lunch", kcal=(400, 650))],
    ),
    Case(
        "copy_yesterday",
        ["text", "dates"],
        [Msg("same breakfast as yesterday")],
        entries=[
            (YESTERDAY, "breakfast", "sg:Kopi C", None),
            (YESTERDAY, "breakfast", "sg:Kaya and butter toast", None),
            (YESTERDAY, "breakfast", "sg:Soft-boiled chicken egg, whole", 2),
        ],
        expect=[
            Item(r"kopi c", "breakfast", kcal=(100, 160)),
            Item(r"kaya", "breakfast", kcal=(300, 450)),
            Item(r"egg", "breakfast", kcal=(120, 150)),
        ],
    ),
    Case(
        "question_only",
        ["text", "question"],
        [Msg("how much protein have I had today?")],
        entries=[
            (TODAY, "lunch", "sg:Steamed chicken rice", None),
            (TODAY, "breakfast", "sg:Kopi C", None),
        ],
        expect=[Item(r"chicken rice", "lunch"), Item(r"kopi c", "breakfast")],
        reply_protein=True,
    ),
    # --- add, then edit in a follow-up message -------------------------------------
    Case(
        "then_fix_one_portion",
        ["text", "edit", "multi_turn", "add_then_edit"],
        [
            Msg("breakfast kopi c and 2 slices kaya toast. lunch chicken rice"),
            Msg("the kaya toast was only 1 slice"),
        ],
        expect=[
            Item(r"kopi c", "breakfast", kcal=(100, 160), from_first_turn=True),
            Item(r"kaya", "breakfast", kcal=(150, 420), from_first_turn=True),
            Item(r"chicken rice", "lunch", kcal=(400, 650), from_first_turn=True),
        ],
    ),
    Case(
        "then_swap_food",
        ["text", "edit", "multi_turn", "add_then_edit"],
        [
            Msg("lunch chicken rice and a teh peng"),
            Msg("oh it was roasted chicken rice, not steamed"),
        ],
        expect=[
            Item(r"roast", "lunch", kcal=(550, 720), from_first_turn=True),
            Item(r"iced teh|teh peng", kcal=(120, 260), from_first_turn=True),
        ],
    ),
    Case(
        "then_set_meal",
        ["text", "edit", "multi_turn", "add_then_edit"],
        [Msg("kopi c and kaya toast"), Msg("those were breakfast")],
        expect=[
            Item(r"kopi c", "breakfast", kcal=(100, 160), from_first_turn=True),
            Item(r"kaya", "breakfast", kcal=(300, 800), from_first_turn=True),
        ],
    ),
    Case(
        "then_remove_one",
        ["text", "edit", "multi_turn", "add_then_edit"],
        [Msg("dinner laksa and a lime juice"), Msg("scratch the lime juice")],
        expect=[Item(r"laksa", "dinner", kcal=(350, 480), from_first_turn=True)],
    ),
    Case(
        "then_move_to_yesterday",
        ["text", "edit", "multi_turn", "add_then_edit", "dates"],
        [Msg("lunch bak chor mee dry"), Msg("sorry, that was yesterday's lunch")],
        check_dates=[TODAY, YESTERDAY],
        expect=[
            Item(r"bak chor mee", "lunch", date=YESTERDAY, kcal=(400, 700), from_first_turn=True)
        ],
    ),
    Case(
        "then_variant",
        ["text", "edit", "multi_turn", "add_then_edit"],
        [Msg("teh c for breakfast"), Msg("make it siew dai")],
        expect=[Item(r"teh c (siu|siew) dai", "breakfast", kcal=(30, 110), from_first_turn=True)],
    ),
    Case(
        "then_add_another_not_edit",
        ["text", "multi_turn", "add_then_edit"],
        [Msg("breakfast kopi c"), Msg("and another kopi c at 3pm")],
        expect=[
            Item(r"kopi c", "breakfast", kcal=(100, 160), from_first_turn=True),
            Item(r"kopi c", "snacks", kcal=(100, 160)),
        ],
    ),
    # --- regressions: patterns that went wrong in real use, with made-up meals ---------
    Case(
        "reg_yesterday_when_log_date_is_yesterday",
        ["text", "dates", "regression", "stale_date"],
        [Msg("beef hor fun for dinner yesterday")],
        now=MORNING,
        log_date=YESTERDAY,
        entries=[
            (YESTERDAY, "breakfast", "sg:Kopi C", None),
            (YESTERDAY, "breakfast", "sg:Kaya and butter toast", None),
        ],
        check_dates=[DAY_BEFORE, YESTERDAY, TODAY],
        expect=[
            Item(r"hor fun", "dinner", date=YESTERDAY, kcal=(450, 900)),
            Item(r"kopi c", "breakfast", date=YESTERDAY),
            Item(r"kaya", "breakfast", date=YESTERDAY),
        ],
    ),
    Case(
        "reg_today_when_log_date_is_yesterday",
        ["text", "dates", "regression", "stale_date"],
        [Msg("lunch today was fishball noodle soup")],
        now="2026-10-21T12:50",
        log_date=YESTERDAY,
        check_dates=[YESTERDAY, TODAY],
        expect=[Item(r"fish ?ball", "lunch", date=TODAY, kcal=(350, 700))],
    ),
    Case(
        "reg_very_big_portion",
        ["text", "edit", "multi_turn", "regression", "portion"],
        [Msg("lunch: hokkien mee"), Msg("it was a very big portion")],
        expect=[Item(r"hokkien", "lunch", kcal=(950, 1700), from_first_turn=True)],
        total_drop=(-1000, -120),  # the total has to rise
    ),
    Case(
        "reg_split_into_portions_edit",
        ["text", "edit", "regression", "split"],
        [Msg("we shared all of dinner, it was split into 4 portions and I had one")],
        entries=[
            {"date": TODAY, "meal": "dinner", "ref": "sg:Chicken curry", "grams": 600},
            {"date": TODAY, "meal": "dinner", "ref": "sg:Cooked white rice", "grams": 600},
            {"date": TODAY, "meal": "dinner", "ref": "sg:Sambal kangkong", "grams": 300},
        ],
        expect=[
            Item(r"curry", "dinner", kcal=(180, 250)),
            Item(r"rice", "dinner", kcal=(165, 225)),
            Item(r"kangkong", "dinner", kcal=(85, 115)),
        ],
        total_kcal=(440, 590),
    ),
    Case(
        "reg_split_into_portions_text",
        ["text", "portion", "regression", "split"],
        [Msg("lunch: 2 plates of char kway teow split into 4 portions, I had one")],
        expect=[Item(r"char kway teow", "lunch", kcal=(380, 600))],
    ),
    Case(
        "reg_save_logged_meal",
        ["text", "ours", "regression", "save_as"],
        [Msg("save today's lunch as corner stall hokkien mee so I can log it next time")],
        entries=[
            {"date": TODAY, "meal": "lunch", "ref": "sg:Hokkien mee", "grams": 700},
            {
                "date": TODAY,
                "meal": "lunch",
                "name": "Sambal sotong side",
                "kcal": 180,
                "protein_g": 15,
                "carb_g": 8,
                "fat_g": 10,
            },
        ],
        expect=[
            Item(r"hokkien", "lunch", kcal=(1000, 1100)),
            Item(r"sotong", "lunch", kcal=(170, 190)),
        ],
        foods=[FoodCheck(r"corner stall", serving_kcal=(1100, 1350))],
        max_tool_calls=3,
    ),
    Case(
        "reg_ours_shared_word",
        ["text", "ours", "regression", "search"],
        [Msg("dinner: 2 braised beef short ribs and a bowl of rice")],
        ours=[CP_RIB],
        expect=[
            Item(r"rib", "dinner", kcal=(300, 1100), not_ours="rib"),
            Item(r"rice", "dinner", kcal=(200, 340)),
        ],
    ),
    Case(
        "reg_tau_pok_not_poke",
        ["text", "regression", "search"],
        [Msg("dinner: 2 pieces of tau pok and a bowl of rice")],
        expect=[
            Item(r"tau ?pok|bean ?curd", "dinner", kcal=(60, 260)),
            Item(r"rice", "dinner", kcal=(200, 340)),
        ],
        forbid=[r"pok[eé]"],
    ),
    Case(
        "reg_pork_collar_not_collards",
        ["text", "regression", "search"],
        [Msg("dinner: 150g grilled pork collar with a bowl of rice")],
        expect=[
            Item(r"pork", "dinner", kcal=(280, 550)),
            Item(r"rice", "dinner", kcal=(200, 340)),
        ],
        forbid=[r"collard"],
    ),
    Case(
        "reg_prawns_not_prawn_dish",
        ["text", "regression", "search"],
        [Msg("dinner: a bowl of rice, 4 steamed prawns and a scoop of stir fried kailan")],
        expect=[
            Item(r"prawn|shrimp", "dinner", kcal=(30, 130)),
            Item(r"rice", "dinner", kcal=(200, 340)),
            Item(r"kai ?lan", "dinner", kcal=(40, 120)),
        ],
        forbid=[r"noodle|mock|assam|cereal|sambal|fritter|drunken"],
    ),
    Case(
        "reg_fried_hokkien_mee_not_prawn_noodles",
        ["text", "regression", "near_name"],
        [Msg("lunch: fried hokkien prawn mee")],
        expect=[Item(r"hokkien", "lunch", kcal=(650, 1050))],
        forbid=[r"prawn noodles"],
    ),
    Case(
        "reg_roasted_chicken_rice_not_white_rice",
        ["text", "regression", "near_name"],
        [
            Msg(
                "lunch: roasted chicken rice, the rice and chicken came on separate plates, "
                "with a bowl of clear soup"
            )
        ],
        expect=[
            Item(r"roast(ed)? chicken rice", "lunch", kcal=(500, 850)),
            Item(r"soup", "lunch", optional=True),
        ],
        forbid=[r"white rice|cooked rice|plain rice|^rice"],
    ),
    Case(
        "reg_half_bowl_not_half_plate",
        ["text", "portion", "regression", "default_serving"],
        [Msg("dinner: half a bowl of nasi goreng")],
        expect=[Item(r"nasi goreng|fried rice", "dinner", kcal=(110, 300))],
    ),
    Case(
        "reg_small_slice",
        ["text", "portion", "regression", "default_serving"],
        [Msg("snack: a small thin slice of chocolate cake")],
        expect=[Item(r"chocolate cake", "snacks", kcal=(100, 260))],
    ),
    Case(
        "reg_fried_carrot_cake_not_dessert",
        ["text", "regression", "near_name"],
        [Msg("breakfast: white fried carrot cake")],
        expect=[Item(r"carrot cake|chai tow kway", "breakfast", kcal=(300, 700))],
        forbid=[r"dessert|cupcake|cake or|pudding"],
    ),
]


def _load_private() -> list[Case]:
    """Cases in evals/private/cases.py (gitignored), tagged private; their photos are in photos/."""
    path = PRIVATE / "cases.py"
    if not path.exists():
        return []
    spec = importlib.util.spec_from_file_location("evals_private_cases", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    for case in module.CASES:
        if "private" not in case.tags:
            case.tags.append("private")
    return module.CASES


CASES += _load_private()

# A meal photo can be split into any number of parts; judge its components and total instead.
for _case in CASES:
    if "meal" in _case.tags:
        _case.strict_count = False

BY_ID = {c.id: c for c in CASES}
assert len(BY_ID) == len(CASES), "duplicate case ids"
