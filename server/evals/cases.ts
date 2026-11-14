/**
 * Eval cases for the Bao logging agent.
 *
 * Each case seeds a fresh database, sends one or more messages through the real agent loop, and is
 * graded on what ends up in the database. The cases here are text only and made up; prodCases.ts
 * holds the cases taken from real use, including every photo case (photos in evals/photos/).
 */
import { CASES as PROD_CASES } from "./prodCases.js";
import { Case, DAY_BEFORE, FoodCheck, Item, MORNING, Msg, TODAY, YESTERDAY } from "./spec.js";

const CHOBANI = {
  key: "chobani",
  name: "Greek Yogurt Light",
  brand: "Chobani",
  nutrients: { kcal: 63, protein_g: 10.0, carb_g: 5.0, fat_g: 0.0 },
  servings: [
    { label: "tub", grams: 150, default: true },
    { label: "bowl", grams: 200 },
  ],
  aliases: ["yogurt", "greek yogurt"],
};
const CP_RIB = {
  key: "rib",
  name: "Hot & Crispy Chicken Rib",
  brand: "CP",
  nutrients: { kcal: 302, protein_g: 12.5, carb_g: 12.0, fat_g: 22.7 },
  servings: [
    { label: "piece", grams: 20, default: true },
    { label: "pack", grams: 350 },
  ],
  aliases: ["chicken rib", "chicken ribs"],
};

const MADE_UP: Case[] = [
  // --- end-of-day text dumps ---------------------------------------------------
  Case(
    "dump_hawker_day",
    ["text", "dump"],
    [
      Msg(
        "breakfast kopi c and 2 slices kaya toast. lunch chicken rice. dinner fish soup bee hoon. teh peng in the afternoon",
      ),
    ],
    {
      expect: [
        Item("kopi c", "breakfast", { kcal: [100, 160] }),
        Item("kaya", "breakfast", { kcal: [300, 800] }),
        Item("chicken rice", "lunch", { kcal: [400, 650] }),
        Item("fish.*bee ?hoon|bee ?hoon.*fish|fish soup", "dinner", { kcal: [300, 600] }),
        Item("iced teh|teh peng", "snacks", { kcal: [120, 260] }),
      ],
    },
  ),
  Case(
    "dump_three_meals_supper",
    ["text", "dump"],
    [Msg("lunch nasi lemak with chicken wing. dinner bak chor mee dry. supper ice kachang")],
    {
      expect: [
        Item("nasi lemak", "lunch", { kcal: [600, 1000] }),
        Item("bak chor mee", "dinner", { kcal: [400, 700] }),
        Item("ice ka(c|ch)ang", "snacks", { kcal: [180, 380] }),
      ],
    },
  ),
  Case(
    "singlish_drinks",
    ["text", "dump"],
    [Msg("afternoon drinks: kopi o kosong, milo peng, teh c siew dai")],
    {
      expect: [
        Item("kopi o kosong", "snacks", { kcal: [10, 60] }),
        Item("milo", "snacks", { kcal: [150, 350] }),
        Item("teh c (siu|siew) dai", "snacks", { kcal: [30, 110] }),
      ],
    },
  ),
  Case(
    "counts_satay_ketupat",
    ["text", "portion"],
    [Msg("dinner: 10 sticks of chicken satay and half a ketupat")],
    {
      expect: [
        Item("satay", "dinner", { kcal: [180, 600] }),
        Item("ketupat", "dinner", { kcal: [30, 70] }),
        Item("sauce|peanut", "dinner", { optional: true }),
      ],
    },
  ),
  Case(
    "weights_grams",
    ["text", "portion"],
    [Msg("dinner was 200g grilled chicken breast and 150g brown rice")],
    {
      expect: [
        Item("chicken", "dinner", { kcal: [260, 460] }),
        Item("brown rice", "dinner", { kcal: [150, 240] }),
      ],
    },
  ),
  Case("names_what_user_said", ["text", "portion"], [Msg("breakfast was 3 eggs soft boiled")], {
    expect: [Item("soft", "breakfast", { kcal: [180, 260] })],
    forbid: ["hard"],
  }),
  Case("estimate_from_similar_food", ["text", "estimate"], [Msg("2 onsen eggs for breakfast")], {
    expect: [Item("onsen", "breakfast", { kcal: [110, 200] })],
    forbid: ["tart|fu ?yong|sambal"],
  }),
  Case(
    "western_breakfast",
    ["text", "dump"],
    [Msg("breakfast: 2 eggs, toast with butter and a black coffee")],
    {
      expect: [
        Item("egg", "breakfast", { kcal: [120, 260] }),
        Item("toast|bread", "breakfast", { kcal: [50, 400] }),
        Item("butter", "breakfast", { optional: true }),
        Item("coffee|kopi", "breakfast", { kcal: [0, 60] }),
      ],
    },
  ),
  Case(
    "estimate_unlisted_dish",
    ["text", "estimate"],
    [Msg("lunch: mala xiang guo, medium bowl, mostly veg with some luncheon meat")],
    {
      expect: [
        Item("mala", "lunch", { kcal: [400, 1300] }),
        Item("luncheon|spam", "lunch", { optional: true }),
      ],
      total_kcal: [500, 1400],
    },
  ),
  Case("estimate_dish_with_near_miss", ["text", "estimate"], [Msg("unagi fried rice for lunch")], {
    expect: [Item("unagi|eel", "lunch")],
    strict_count: false,
    total_kcal: [650, 1200],
  }),
  Case(
    "two_days_one_message",
    ["text", "dates"],
    [Msg("yesterday dinner was hokkien mee. today lunch was yong tau foo soup, 7 pieces")],
    {
      check_dates: [TODAY, YESTERDAY],
      expect: [
        Item("hokkien", "dinner", { date: YESTERDAY, kcal: [550, 1000] }),
        Item("yong tau foo", "lunch", { kcal: [150, 600] }),
      ],
    },
  ),
  Case(
    "yesterday_breakfast",
    ["text", "dates"],
    [Msg("yesterday breakfast I had 2 roti prata with curry and a teh tarik")],
    {
      check_dates: [TODAY, YESTERDAY],
      expect: [
        Item("prata", "breakfast", { date: YESTERDAY, kcal: [350, 1050] }),
        Item("curry", "breakfast", { date: YESTERDAY, optional: true }),
        Item("teh tarik", "breakfast", { date: YESTERDAY, kcal: [50, 200] }),
      ],
    },
  ),
  // --- household foods as defaults -------------------------------------------
  Case("ours_bowl_of_yogurt", ["text", "ours"], [Msg("had a bowl of yogurt with a banana for breakfast")], {
    ours: [CHOBANI],
    expect: [
      Item("yogurt", "breakfast", { kcal: [120, 135], ours: "chobani" }),
      Item("banana", "breakfast", { kcal: [60, 130] }),
    ],
  }),
  Case(
    "ours_overridden_by_brand",
    ["text", "ours"],
    [Msg("breakfast: a cup of Fage full fat greek yogurt at the hotel")],
    { ours: [CHOBANI], expect: [Item("yog|fage", "breakfast", { kcal: [150, 330], not_ours: "chobani" })] },
  ),
  Case("ours_pieces", ["text", "ours"], [Msg("dinner: 6 pieces of the chicken rib with a bowl of rice")], {
    ours: [CP_RIB],
    expect: [
      Item("rib", "dinner", { kcal: [355, 370], ours: "rib" }),
      Item("rice", "dinner", { kcal: [200, 340] }),
    ],
  }),
  Case("teach_serving", ["text", "ours"], [Msg("fyi my yogurt bowl is about 250g, not 200")], {
    ours: [CHOBANI],
    expect: [],
    foods: [FoodCheck("yogurt", { serving_grams: [[245, 255]], aliases_include: ["yogurt"] })],
  }),
  // --- corrections and edits ---------------------------------------------------
  Case(
    "followup_portion",
    ["text", "edit", "multi_turn"],
    [Msg("lunch char kway teow"), Msg("actually it was a large plate, make it 1.5")],
    { expect: [Item("char kway teow", "lunch", { kcal: [1300, 1600] })] },
  ),
  Case(
    "followup_add",
    ["text", "multi_turn"],
    [Msg("lunch: chicken rice"), Msg("oh and a lime juice with it")],
    {
      expect: [
        Item("chicken rice", "lunch", { kcal: [400, 650] }),
        Item("lime", "lunch", { kcal: [50, 160] }),
      ],
    },
  ),
  Case("move_meal", ["text", "edit"], [Msg("the kopi was in the afternoon, not breakfast")], {
    entries: [
      [TODAY, "breakfast", "sg:Kopi C", null],
      [TODAY, "breakfast", "sg:Kaya and butter toast", null],
    ],
    expect: [Item("kopi c", "snacks", { kcal: [100, 160] }), Item("kaya", "breakfast", { kcal: [300, 450] })],
  }),
  Case(
    "edit_yesterday",
    ["text", "edit", "dates"],
    [Msg("yesterday's dinner, I only finished half the laksa")],
    {
      entries: [
        [YESTERDAY, "dinner", "sg:Laksa", null],
        [YESTERDAY, "lunch", "sg:Steamed chicken rice", null],
      ],
      check_dates: [TODAY, YESTERDAY],
      expect: [
        Item("laksa", "dinner", { date: YESTERDAY, kcal: [190, 230] }),
        Item("chicken rice", "lunch", { date: YESTERDAY, kcal: [400, 650] }),
      ],
    },
  ),
  Case("delete_item", ["text", "edit"], [Msg("remove the teh peng, I didn't have it")], {
    entries: [
      [TODAY, "snacks", "sg:Iced Teh", null],
      [TODAY, "lunch", "sg:Steamed chicken rice", null],
    ],
    expect: [Item("chicken rice", "lunch", { kcal: [400, 650] })],
  }),
  Case("copy_yesterday", ["text", "dates"], [Msg("same breakfast as yesterday")], {
    entries: [
      [YESTERDAY, "breakfast", "sg:Kopi C", null],
      [YESTERDAY, "breakfast", "sg:Kaya and butter toast", null],
      [YESTERDAY, "breakfast", "sg:Soft-boiled chicken egg, whole", 2],
    ],
    expect: [
      Item("kopi c", "breakfast", { kcal: [100, 160] }),
      Item("kaya", "breakfast", { kcal: [300, 450] }),
      Item("egg", "breakfast", { kcal: [120, 150] }),
    ],
  }),
  Case("question_only", ["text", "question"], [Msg("how much protein have I had today?")], {
    entries: [
      [TODAY, "lunch", "sg:Steamed chicken rice", null],
      [TODAY, "breakfast", "sg:Kopi C", null],
    ],
    expect: [Item("chicken rice", "lunch"), Item("kopi c", "breakfast")],
    reply_protein: true,
  }),
  // --- add, then edit in a follow-up message -------------------------------------
  Case(
    "then_fix_one_portion",
    ["text", "edit", "multi_turn", "add_then_edit"],
    [
      Msg("breakfast kopi c and 2 slices kaya toast. lunch chicken rice"),
      Msg("the kaya toast was only 1 slice"),
    ],
    {
      expect: [
        Item("kopi c", "breakfast", { kcal: [100, 160], from_first_turn: true }),
        Item("kaya", "breakfast", { kcal: [150, 420], from_first_turn: true }),
        Item("chicken rice", "lunch", { kcal: [400, 650], from_first_turn: true }),
      ],
    },
  ),
  Case(
    "then_swap_food",
    ["text", "edit", "multi_turn", "add_then_edit"],
    [Msg("lunch chicken rice and a teh peng"), Msg("oh it was roasted chicken rice, not steamed")],
    {
      expect: [
        Item("roast", "lunch", { kcal: [550, 720], from_first_turn: true }),
        Item("iced teh|teh peng", { kcal: [120, 260], from_first_turn: true }),
      ],
    },
  ),
  Case(
    "then_set_meal",
    ["text", "edit", "multi_turn", "add_then_edit"],
    [Msg("kopi c and kaya toast"), Msg("those were breakfast")],
    {
      expect: [
        Item("kopi c", "breakfast", { kcal: [100, 160], from_first_turn: true }),
        Item("kaya", "breakfast", { kcal: [300, 800], from_first_turn: true }),
      ],
    },
  ),
  Case(
    "then_remove_one",
    ["text", "edit", "multi_turn", "add_then_edit"],
    [Msg("dinner laksa and a lime juice"), Msg("scratch the lime juice")],
    { expect: [Item("laksa", "dinner", { kcal: [350, 480], from_first_turn: true })] },
  ),
  Case(
    "then_move_to_yesterday",
    ["text", "edit", "multi_turn", "add_then_edit", "dates"],
    [Msg("lunch bak chor mee dry"), Msg("sorry, that was yesterday's lunch")],
    {
      check_dates: [TODAY, YESTERDAY],
      expect: [Item("bak chor mee", "lunch", { date: YESTERDAY, kcal: [400, 700], from_first_turn: true })],
    },
  ),
  Case(
    "then_variant",
    ["text", "edit", "multi_turn", "add_then_edit"],
    [Msg("teh c for breakfast"), Msg("make it siew dai")],
    { expect: [Item("teh c (siu|siew) dai", "breakfast", { kcal: [30, 110], from_first_turn: true })] },
  ),
  Case(
    "then_add_another_not_edit",
    ["text", "multi_turn", "add_then_edit"],
    [Msg("breakfast kopi c"), Msg("and another kopi c at 3pm")],
    {
      expect: [
        Item("kopi c", "breakfast", { kcal: [100, 160], from_first_turn: true }),
        Item("kopi c", "snacks", { kcal: [100, 160] }),
      ],
    },
  ),
  // --- regressions: patterns that went wrong in real use, with made-up meals ---------
  Case(
    "reg_yesterday_when_log_date_is_yesterday",
    ["text", "dates", "regression", "stale_date"],
    [Msg("beef hor fun for dinner yesterday")],
    {
      now: MORNING,
      log_date: YESTERDAY,
      entries: [
        [YESTERDAY, "breakfast", "sg:Kopi C", null],
        [YESTERDAY, "breakfast", "sg:Kaya and butter toast", null],
      ],
      check_dates: [DAY_BEFORE, YESTERDAY, TODAY],
      expect: [
        Item("hor fun", "dinner", { date: YESTERDAY, kcal: [450, 900] }),
        Item("kopi c", "breakfast", { date: YESTERDAY }),
        Item("kaya", "breakfast", { date: YESTERDAY }),
      ],
    },
  ),
  Case(
    "reg_today_when_log_date_is_yesterday",
    ["text", "dates", "regression", "stale_date"],
    [Msg("lunch today was fishball noodle soup")],
    {
      now: "2026-10-21T12:50",
      log_date: YESTERDAY,
      check_dates: [YESTERDAY, TODAY],
      expect: [Item("fish ?ball", "lunch", { date: TODAY, kcal: [350, 700] })],
    },
  ),
  Case(
    "reg_very_big_portion",
    ["text", "edit", "multi_turn", "regression", "portion"],
    [Msg("lunch: hokkien mee"), Msg("it was a very big portion")],
    {
      expect: [Item("hokkien", "lunch", { kcal: [950, 1700], from_first_turn: true })],
      total_drop: [-1000, -120], // the total has to rise
    },
  ),
  Case(
    "reg_split_into_portions_edit",
    ["text", "edit", "regression", "split"],
    [Msg("we shared all of dinner, it was split into 4 portions and I had one")],
    {
      entries: [
        { date: TODAY, meal: "dinner", ref: "sg:Chicken curry", grams: 600 },
        { date: TODAY, meal: "dinner", ref: "sg:Cooked white rice", grams: 600 },
        { date: TODAY, meal: "dinner", ref: "sg:Sambal kangkong", grams: 300 },
      ],
      expect: [
        Item("curry", "dinner", { kcal: [180, 250] }),
        Item("rice", "dinner", { kcal: [165, 225] }),
        Item("kangkong", "dinner", { kcal: [85, 115] }),
      ],
      total_kcal: [440, 590],
    },
  ),
  Case(
    "reg_split_into_portions_text",
    ["text", "portion", "regression", "split"],
    [Msg("lunch: 2 plates of char kway teow split into 4 portions, I had one")],
    { expect: [Item("char kway teow", "lunch", { kcal: [380, 600] })] },
  ),
  Case(
    "reg_save_logged_meal",
    ["text", "ours", "regression", "save_as"],
    [Msg("save today's lunch as corner stall hokkien mee so I can log it next time")],
    {
      entries: [
        { date: TODAY, meal: "lunch", ref: "sg:Hokkien mee", grams: 700 },
        {
          date: TODAY,
          meal: "lunch",
          name: "Sambal sotong side",
          kcal: 180,
          protein_g: 15,
          carb_g: 8,
          fat_g: 10,
        },
      ],
      expect: [
        Item("hokkien", "lunch", { kcal: [1000, 1100] }),
        Item("sotong", "lunch", { kcal: [170, 190] }),
      ],
      foods: [FoodCheck("corner stall", { serving_kcal: [1100, 1350] })],
      max_tool_calls: 3,
    },
  ),
  Case(
    "reg_ours_shared_word",
    ["text", "ours", "regression", "search"],
    [Msg("dinner: 2 braised beef short ribs and a bowl of rice")],
    {
      ours: [CP_RIB],
      expect: [
        Item("rib", "dinner", { kcal: [300, 1100], not_ours: "rib" }),
        Item("rice", "dinner", { kcal: [200, 340] }),
      ],
    },
  ),
  Case(
    "reg_tau_pok_not_poke",
    ["text", "regression", "search"],
    [Msg("dinner: 2 pieces of tau pok and a bowl of rice")],
    {
      expect: [
        Item("tau ?pok|bean ?curd", "dinner", { kcal: [60, 260] }),
        Item("rice", "dinner", { kcal: [200, 340] }),
      ],
      forbid: ["pok[eé]"],
    },
  ),
  Case(
    "reg_pork_collar_not_collards",
    ["text", "regression", "search"],
    [Msg("dinner: 150g grilled pork collar with a bowl of rice")],
    {
      expect: [Item("pork", "dinner", { kcal: [280, 550] }), Item("rice", "dinner", { kcal: [200, 340] })],
      forbid: ["collard"],
    },
  ),
  Case(
    "reg_prawns_not_prawn_dish",
    ["text", "regression", "search"],
    [Msg("dinner: a bowl of rice, 4 steamed prawns and a scoop of stir fried kailan")],
    {
      expect: [
        Item("prawn|shrimp", "dinner", { kcal: [30, 130] }),
        Item("rice", "dinner", { kcal: [200, 340] }),
        Item("kai ?lan", "dinner", { kcal: [40, 120] }),
      ],
      forbid: ["noodle|mock|assam|cereal|sambal|fritter|drunken"],
    },
  ),
  Case(
    "reg_fried_hokkien_mee_not_prawn_noodles",
    ["text", "regression", "near_name"],
    [Msg("lunch: fried hokkien prawn mee")],
    { expect: [Item("hokkien", "lunch", { kcal: [650, 1050] })], forbid: ["prawn noodles"] },
  ),
  Case(
    "reg_roasted_chicken_rice_not_white_rice",
    ["text", "regression", "near_name"],
    [
      Msg(
        "lunch: roasted chicken rice, the rice and chicken came on separate plates, with a bowl of clear soup",
      ),
    ],
    {
      expect: [
        Item("roast(ed)? chicken rice", "lunch", { kcal: [500, 850] }),
        Item("soup", "lunch", { optional: true }),
      ],
      forbid: ["white rice|cooked rice|plain rice|^rice"],
    },
  ),
  Case(
    "reg_half_bowl_not_half_plate",
    ["text", "portion", "regression", "default_serving"],
    [Msg("dinner: half a bowl of nasi goreng")],
    { expect: [Item("nasi goreng|fried rice", "dinner", { kcal: [110, 300] })] },
  ),
  Case(
    "reg_small_slice",
    ["text", "portion", "regression", "default_serving"],
    [Msg("snack: a small thin slice of chocolate cake")],
    { expect: [Item("chocolate cake", "snacks", { kcal: [100, 260] })] },
  ),
  Case(
    "reg_fried_carrot_cake_not_dessert",
    ["text", "regression", "near_name"],
    [Msg("breakfast: white fried carrot cake")],
    {
      expect: [Item("carrot cake|chai tow kway", "breakfast", { kcal: [300, 700] })],
      forbid: ["dessert|cupcake|cake or|pudding"],
    },
  ),
];

export const CASES: Case[] = [...MADE_UP, ...PROD_CASES];

// A meal photo can be split into any number of parts; judge its components and total instead.
for (const c of CASES) if (c.tags.includes("meal")) c.strict_count = false;

export const BY_ID = new Map(CASES.map((c) => [c.id, c]));
if (BY_ID.size !== CASES.length) throw new Error("duplicate case ids");
