"""Eval cases for the makan logging agent.

Each case seeds a fresh database, sends one or more messages through the real agent loop, and is
graded on what ends up in the database. Photo-case reference totals were estimated by Claude
(Opus 5.5 in Claude Code) looking at each photo, as the benchmark for photo understanding.
"""

from dataclasses import dataclass, field

TODAY = "2026-10-21"
YESTERDAY = "2026-10-20"
EVENING = "2026-10-21T21:30"

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
FAIRPRICE_OAT = {
    "key": "fp_oat",
    "name": "Oat Milk",
    "brand": "FairPrice",
    "nutrients": {"kcal": 62, "protein_g": 1.0, "carb_g": 7.2, "fat_g": 3.2},
    "servings": [{"label": "glass", "grams": 250, "default": True}],
    "aliases": ["oat milk"],
}


@dataclass
class Msg:
    text: str
    photo: str | None = None


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


@dataclass
class Case:
    id: str
    tags: list[str]
    msgs: list[Msg]
    now: str = EVENING
    log_date: str = TODAY
    ours: list[dict] = field(default_factory=list)
    # (date, meal, food ref "sg:Name" | "usda:Name" | "ours:key", servings or None)
    entries: list[tuple] = field(default_factory=list)
    expect: list[Item] | None = None  # the complete log for the checked dates
    check_dates: list[str] = field(default_factory=lambda: [TODAY])
    total_kcal: tuple[float, float] | None = None  # on log_date
    ref_kcal: float | None = None  # benchmark estimate for photo cases
    foods: list[FoodCheck] = field(default_factory=list)
    reply_protein: bool = False  # the reply must state the day's protein total
    # How much the log date's kcal total must fall between the first message and the end.
    total_drop: tuple[float, float] | None = None
    forbid: list[str] = field(default_factory=list)  # no entry on the checked dates may match these
    strict_count: bool = (
        True  # False: extra entries are fine (photo meals split into any number of parts)
    )


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
    Case(
        "photo_then_drop_item",
        ["photo", "edit", "multi_turn", "add_then_edit"],
        [Msg("lunch", photo="PXL_20260811_042257624.jpg"), Msg("I didn't eat the you tiao")],
        now="2026-08-11T12:22",
        log_date="2026-08-11",
        check_dates=["2026-08-11"],
        expect=[
            Item(r"bak kut teh|pork rib|rib soup", "lunch", from_first_turn=True),
            Item(r"rice", "lunch", from_first_turn=True),
            Item(r"peanut", "lunch", from_first_turn=True),
        ],
        forbid=[r"you ?tiao|dough|fritter"],
        strict_count=False,
        total_kcal=(450, 1250),
        total_drop=(200, 1100),
    ),
    Case(
        "photo_then_half_rice",
        ["photo", "edit", "multi_turn", "add_then_edit"],
        [Msg("lunch", photo="PXL_20260922_051842044.jpg"), Msg("I only ate half the rice")],
        now="2026-09-22T13:18",
        log_date="2026-09-22",
        check_dates=["2026-09-22"],
        expect=[Item(r"nasi lemak|coconut rice|rice", "lunch", from_first_turn=True)]
        + [Item(r".", "lunch", optional=True)] * 6,
        total_drop=(60, 450),
        strict_count=False,
    ),
    Case(
        "label_then_fix_serving",
        ["photo", "label", "edit", "multi_turn", "add_then_edit"],
        [
            Msg("save this, it's our oat milk", photo="PXL_20261020_103601464.jpg"),
            Msg("we drink it in 200 ml glasses"),
        ],
        now="2026-10-20T18:36",
        log_date="2026-10-20",
        check_dates=["2026-10-20"],
        expect=[],
        foods=[
            FoodCheck(
                r"oat", kcal=(60, 64), serving_grams=[(195, 205)], aliases_include=["oat milk"]
            )
        ],
    ),
    # --- nutrition labels ---------------------------------------------------------
    Case(
        "label_chicken_rib",
        ["photo", "label"],
        [Msg("save this, we always have these in the freezer", photo="PXL_20261004_033808808.jpg")],
        now="2026-10-04T11:38",
        log_date="2026-10-04",
        check_dates=["2026-10-04"],
        expect=[],
        foods=[
            FoodCheck(
                r"chicken rib",
                kcal=(298, 306),
                protein_g=(12, 13),
                carb_g=(11.5, 12.5),
                fat_g=(22, 23.5),
                serving_grams=[(19, 21), (99, 101)],
            )
        ],
    ),
    Case(
        "label_oat_milk_and_log",
        ["photo", "label"],
        [
            Msg(
                "this is our oat milk, save it. also had a glass with breakfast",
                photo="PXL_20261020_103601464.jpg",
            )
        ],
        now="2026-10-20T18:36",
        log_date="2026-10-20",
        check_dates=["2026-10-20"],
        expect=[Item(r"oat", "breakfast", date="2026-10-20", kcal=(120, 170))],
        foods=[
            FoodCheck(
                r"oat",
                kcal=(60, 64),
                protein_g=(0.9, 1.1),
                carb_g=(7, 7.4),
                fat_g=(3.1, 3.3),
                aliases_include=["oat milk"],
            )
        ],
    ),
    Case(
        "label_switch_oat_milk",
        ["photo", "label", "ours"],
        [Msg("we switched to this oat milk", photo="PXL_20261020_103629088.MP.jpg")],
        now="2026-10-20T18:36",
        log_date="2026-10-20",
        check_dates=["2026-10-20"],
        ours=[FAIRPRICE_OAT],
        expect=[],
        foods=[
            FoodCheck(
                r"milklab|oatside|noumi|oat",
                kcal=(63, 67),
                protein_g=(0.6, 0.8),
                carb_g=(7.7, 8.1),
                fat_g=(3.1, 3.3),
                aliases_include=["oat milk"],
            ),
            FoodCheck(r"^Oat Milk$", aliases_exclude=["oat milk"]),
        ],
    ),
    # --- meal photos (reference totals: Claude's estimate from the photo) ---------
    Case(
        "photo_bak_kut_teh",
        ["photo", "meal"],
        [Msg("lunch", photo="PXL_20260811_042257624.jpg")],
        now="2026-08-11T12:22",
        log_date="2026-08-11",
        check_dates=["2026-08-11"],
        expect=[
            Item(r"bak kut teh|pork rib|rib soup", "lunch"),
            Item(r"rice", "lunch"),
            Item(r"you ?tiao|dough|fritter|youtiao", "lunch"),
            Item(r"peanut", "lunch"),
            Item(r".", "lunch", optional=True),
        ],
        total_kcal=(900, 1650),
        ref_kcal=1200,
    ),
    Case(
        "photo_prawn_noodles",
        ["photo", "meal"],
        [Msg("", photo="PXL_20260821_113659295.jpg")],
        now="2026-08-21T19:36",
        log_date="2026-08-21",
        check_dates=["2026-08-21"],
        expect=[
            Item(r"prawn|noodle|mee", "dinner"),
            Item(r".", "dinner", optional=True),
            Item(r".", "dinner", optional=True),
        ],
        total_kcal=(450, 1000),
        ref_kcal=700,
    ),
    Case(
        "photo_home_pork_ribs",
        ["photo", "meal"],
        [
            Msg(
                "dinner, had 2 pieces of this with a bowl of rice",
                photo="PXL_20260902_125326268.MP.jpg",
            )
        ],
        now="2026-09-02T20:53",
        log_date="2026-09-02",
        check_dates=["2026-09-02"],
        expect=[Item(r"pork|rib", "dinner"), Item(r"rice", "dinner")],
        total_kcal=(450, 950),
        ref_kcal=680,
    ),
    Case(
        "photo_tacos",
        ["photo", "meal"],
        [Msg("dinner", photo="PXL_20260914_104534394.jpg")],
        now="2026-09-14T18:45",
        log_date="2026-09-14",
        check_dates=["2026-09-14"],
        expect=[
            Item(r"taco", "dinner"),
            Item(r"taco", "dinner", optional=True),
            Item(r"taco", "dinner", optional=True),
        ],
        total_kcal=(500, 1000),
        ref_kcal=700,
    ),
    Case(
        "photo_onigiri_two",
        ["photo", "meal"],
        [Msg("lunch, I had 2 of these", photo="PXL_20260915_044657210.jpg")],
        now="2026-09-15T12:46",
        log_date="2026-09-15",
        check_dates=["2026-09-15"],
        expect=[
            Item(r"onigiri|nigiri|rice|sushi|musubi|hand ?roll|temaki|cone", "lunch"),
            Item(r".", "lunch", optional=True),
        ],
        total_kcal=(380, 750),
        ref_kcal=540,
    ),
    Case(
        "photo_nasi_lemak_wings",
        ["photo", "meal"],
        [Msg("lunch. the wings were shared, I had 1", photo="PXL_20260922_051842044.jpg")],
        now="2026-09-22T13:18",
        log_date="2026-09-22",
        check_dates=["2026-09-22"],
        expect=[
            Item(r"nasi lemak|coconut rice", "lunch"),
            Item(r"wing", "lunch", kcal=(80, 300)),
            Item(r".", "lunch", optional=True),
            Item(r".", "lunch", optional=True),
            Item(r".", "lunch", optional=True),
        ],
        total_kcal=(750, 1400),
        ref_kcal=1030,
    ),
    Case(
        "photo_wanton_mee",
        ["photo", "meal"],
        [Msg("", photo="PXL_20261003_041719128.jpg")],
        now="2026-10-03T12:17",
        log_date="2026-10-03",
        check_dates=["2026-10-03"],
        expect=[
            Item(r"wanton|wonton|noodle|mee", "lunch"),
            Item(r".", "lunch", optional=True),
            Item(r".", "lunch", optional=True),
        ],
        total_kcal=(450, 900),
        ref_kcal=650,
    ),
    Case(
        "photo_nasi_padang",
        ["photo", "meal"],
        [Msg("dinner", photo="PXL_20261007_120514824.jpg")],
        now="2026-10-07T20:05",
        log_date="2026-10-07",
        check_dates=["2026-10-07"],
        expect=[Item(r"rice|nasi", "dinner")] + [Item(r".", "dinner", optional=True)] * 9,
        total_kcal=(900, 1700),
        ref_kcal=1300,
    ),
    Case(
        "photo_risotto",
        ["photo", "meal"],
        [Msg("lunch", photo="PXL_20261008_053230613.jpg")],
        now="2026-10-08T13:32",
        log_date="2026-10-08",
        check_dates=["2026-10-08"],
        expect=[Item(r"risotto", "lunch"), Item(r".", "lunch", optional=True)],
        total_kcal=(450, 950),
        ref_kcal=650,
    ),
    Case(
        "photo_curry_rice",
        ["photo", "meal"],
        [Msg("lunch", photo="PXL_20261019_050831726.jpg")],
        now="2026-10-19T13:08",
        log_date="2026-10-19",
        check_dates=["2026-10-19"],
        expect=[Item(r"rice|curry", "lunch")] + [Item(r".", "lunch", optional=True)] * 5,
        total_kcal=(850, 1500),
        ref_kcal=1150,
    ),
]

# A meal photo can be split into any number of parts; judge its components and total instead.
for _case in CASES:
    if "meal" in _case.tags:
        _case.strict_count = False

BY_ID = {c.id: c for c in CASES}
assert len(BY_ID) == len(CASES), "duplicate case ids"
