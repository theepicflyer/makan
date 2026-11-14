/**
 * Eval cases from real use: every photo sent to Bao in its first weeks, and text turns it got wrong.
 *
 * Each case keeps the real message, the household foods that existed at the time and the log entries
 * the message referred to. Dates are shifted by a whole number of weeks, so weekdays still match.
 * `regression` marks turns the agent got wrong, `baseline` turns it got right. Reference totals are
 * a reviewer's estimate from the photo, with a tolerance of about +-30% (tighter where the agent's
 * wrong answer fell inside 30%). Times are Singapore time; `created` times are UTC.
 */
import { Case, type EntrySpec, FoodCheck, Item, Msg, type OursSpec, type Range } from "./spec.js";

// Household foods as they were saved, with the time (UTC) they were created.
const NOBO = {
  key: "nobo",
  name: "nobo Soy Milk",
  brand: "nobo",
  nutrients: { kcal: 58, protein_g: 4.2, carb_g: 5.2, fat_g: 2.2 },
  servings: [
    { label: "glass", grams: 200, default: true },
    { label: "carton", grams: 1000 },
  ],
  aliases: ["soy milk", "nobo soy milk"],
  created: "2026-09-18T02:53",
};
const OAT_CHOC = {
  key: "oat_choc",
  name: "Oatside Chocolate Oat Milk",
  brand: "Oatside",
  nutrients: { kcal: 78, protein_g: 1.3, carb_g: 10.8, fat_g: 3.0 },
  servings: [
    { label: "glass", grams: 200, default: true },
    { label: "carton", grams: 1000 },
  ],
  aliases: ["chocolate oat milk", "choc oat milk"],
  created: "2026-09-18T02:53",
};
const OAT_BARISTA = {
  key: "oat_barista",
  name: "Oatside Barista Blend Oat Milk",
  brand: "Oatside",
  nutrients: { kcal: 65, protein_g: 0.7, carb_g: 7.9, fat_g: 3.2 },
  servings: [
    { label: "glass", grams: 200, default: true },
    { label: "carton", grams: 1000 },
  ],
  aliases: ["barista oat milk", "oat milk"],
  created: "2026-09-18T02:53",
};
const CHOBANI = {
  key: "chobani",
  name: "Chobani Greek Light Yogurt",
  brand: "Chobani",
  nutrients: { kcal: 56, protein_g: 9.3, carb_g: 4.0, fat_g: 0.2 },
  servings: [
    { label: "serve", grams: 160 },
    { label: "bowl", grams: 200, default: true },
  ],
  aliases: [
    "greek light yogurt",
    "greek yogurt",
    "yogurt",
    "chobani yogurt",
    "chobani greek yogurt",
    "chobani",
  ],
  created: "2026-09-22T02:41",
};
const EGG_TOFU = {
  key: "egg_tofu",
  name: "Egg Tofu",
  brand: "Fortune Food",
  nutrients: { kcal: 72, protein_g: 7.7, carb_g: 2.1, fat_g: 3.6 },
  servings: [{ label: "pack", grams: 150, default: true }],
  aliases: ["egg tofu"],
  created: "2026-09-27T16:40",
};
// As left after the photo 29 case: 550 g portion, 642 kcal.
const EBI_BAR = {
  key: "ebi_bar",
  name: "Ebi Bar",
  brand: null,
  nutrients: { kcal: 116.73, protein_g: 5.45, carb_g: 14.73, fat_g: 3.64 },
  servings: [{ label: "portion", grams: 550, default: true }],
  aliases: ["ebi bar"],
  created: "2026-09-30T05:06",
};
const CP_RIB = {
  key: "cp_rib",
  name: "CP Signature Chicken Rib",
  brand: "CP",
  nutrients: { kcal: 302, protein_g: 12.5, carb_g: 12.0, fat_g: 22.7 },
  servings: [
    { label: "piece", grams: 20, default: true },
    { label: "pack", grams: 350 },
  ],
  aliases: ["cp fried chicken rib", "cp chicken rib", "chicken rib", "fried chicken rib"],
  created: "2026-10-01T03:03",
};
const CARMANS = {
  key: "carmans",
  name: "Carman's Kitchen Nut Protein Bar",
  brand: "Carman's Kitchen",
  nutrients: { kcal: 490, protein_g: 25.9, carb_g: 27.8, fat_g: 29.0 },
  servings: [{ label: "bar", grams: 40, default: true }],
  aliases: ["carman's bar", "carmans kitchen bar", "protein bar"],
  created: "2026-10-05T07:06",
};
const ALL_OURS = [NOBO, OAT_CHOC, OAT_BARISTA, CHOBANI, EGG_TOFU, EBI_BAR, CP_RIB, CARMANS];

/** The household foods that existed at a moment (UTC). */
function ours_at(utc: string): OursSpec[] {
  return ALL_OURS.filter((f) => f.created! <= utc);
}

function est(
  day: string,
  meal: string,
  name: string,
  kcal: number,
  p = 0,
  c = 0,
  f = 0,
  grams: number | null = null,
): EntrySpec {
  return { date: day, meal, name, kcal, protein_g: p, carb_g: c, fat_g: f, grams };
}

function food(
  day: string,
  meal: string,
  ref: string,
  options: { servings?: number; serving?: string; grams?: number; name?: string } = {},
): EntrySpec {
  return { date: day, meal, ref, servings: null, serving: null, grams: null, name: null, ...options };
}

function anything(meal: string | null, n: number, date: string | null = null): Item[] {
  return Array.from({ length: n }, () => Item(".", meal, { date, optional: true }));
}

/** A seeded entry that should still be there. */
function kept(day: string, meal: string, pattern: string): Item {
  return Item(pattern, meal, { date: day });
}

function ref_range(ref: number, tol = 0.3): Range {
  return [pyRound(ref * (1 - tol)), pyRound(ref * (1 + tol))];
}

/** Round half to even, as the reviewer's ranges were first computed. */
function pyRound(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

const [R, B] = ["regression", "baseline"];

export const CASES: Case[] = [
  // --- labels -------------------------------------------------------------------
  // Photos 2-4: three milk labels saved exactly, nothing logged. Label baseline.
  Case(
    "prod_p02_milk_labels",
    ["photo", "label", B],
    [Msg("add these to my library", { photos: ["photo02.jpg", "photo03.jpg", "photo04.jpg"] })],
    {
      now: "2026-09-18T10:53",
      log_date: "2026-09-18",
      check_dates: ["2026-09-18"],
      expect: [],
      foods: [
        FoodCheck("soy", {
          kcal: [57.5, 58.5],
          protein_g: [4.1, 4.3],
          carb_g: [5.1, 5.3],
          fat_g: [2.1, 2.3],
        }),
        FoodCheck("choc", {
          kcal: [77.5, 78.5],
          protein_g: [1.2, 1.4],
          carb_g: [10.7, 10.9],
          fat_g: [2.9, 3.1],
        }),
        FoodCheck("barista", {
          kcal: [64.5, 65.5],
          protein_g: [0.6, 0.8],
          carb_g: [7.8, 8.0],
          fat_g: [3.1, 3.3],
        }),
      ],
    },
  ),
  // Photo 11: yogurt label saved exactly, 160 g serve, not logged. Label baseline.
  Case(
    "prod_p11_yogurt_label",
    ["photo", "label", B],
    [Msg("this is our usual chobani greek light yogurt", { photo: "photo11.jpg" })],
    {
      now: "2026-09-22T10:41",
      log_date: "2026-09-21",
      ours: ours_at("2026-09-22T02:40"),
      check_dates: ["2026-09-21", "2026-09-22"],
      expect: [],
      foods: [
        FoodCheck("chobani|greek", {
          kcal: [55.5, 56.5],
          protein_g: [9.2, 9.4],
          carb_g: [3.9, 4.1],
          fat_g: [0.1, 0.3],
          serving_grams: [[159, 161]],
        }),
      ],
    },
  ),
  // Photo 24: egg tofu label; the earlier entry linked "Steamed egg with tofu" (see t53)
  // must switch to the saved label food, plus an estimate for the coating and frying oil.
  Case(
    "prod_p24_egg_tofu_label",
    ["photo", "label", "edit", B],
    [
      Msg(
        "it's egg tofu. this is a photo of the label. it was coated in corn flour and deep fried before going into the hotplate with the rest",
        { photo: "photo24.jpg" },
      ),
    ],
    {
      now: "2026-09-28T00:40",
      log_date: "2026-09-27",
      ours: ours_at("2026-09-27T16:39"),
      entries: [
        food("2026-09-27", "dinner", "sg:Minced pork, raw", { grams: 150 }),
        est("2026-09-27", "dinner", "Prawns (4 small, hot plate tofu)", 60, 12, 0, 1),
        food("2026-09-27", "dinner", "sg:Steamed egg with tofu", { grams: 150 }),
        est("2026-09-27", "dinner", "Mushrooms (hot plate tofu)", 18, 2, 3, 0),
        food("2026-09-27", "dinner", "sg:Cauliflower, raw", { grams: 100 }),
        food("2026-09-27", "dinner", "sg:Cooked white rice", { servings: 1 }),
      ],
      check_dates: ["2026-09-27", "2026-09-28"],
      expect: [
        kept("2026-09-27", "dinner", "minced pork"),
        kept("2026-09-27", "dinner", "prawn"),
        kept("2026-09-27", "dinner", "mushroom"),
        kept("2026-09-27", "dinner", "cauliflower"),
        kept("2026-09-27", "dinner", "rice"),
        // The coating and oil may be a separate estimate or folded into the egg tofu entry.
        Item("egg tofu", "dinner", { kcal: [100, 300] }),
        Item("coat|flour|oil|fr(y|ied)", "dinner", { kcal: [50, 250], optional: true }),
      ],
      forbid: ["steamed egg"],
      foods: [
        FoodCheck("egg tofu", {
          kcal: [71.5, 72.5],
          protein_g: [7.6, 7.8],
          carb_g: [2.0, 2.2],
          fat_g: [3.5, 3.7],
          serving_grams: [[149, 151]],
        }),
      ],
    },
  ),
  // Photo 31: chicken rib label saved exactly (baseline), but "yesterday's dinner" was
  // logged on 29 Sep: the app was already on 30 Sep (yesterday), so it subtracted a day twice.
  Case(
    "prod_p31_rib_label_yesterday",
    ["photo", "label", "dates", R, "stale_date"],
    [
      Msg(
        "yesterday's dinner was 10 pan fried dumplings, 3 pieces of the chicken in the photo. you can save this as CP fried chicken rib",
        { photo: "photo31.jpg" },
      ),
    ],
    {
      now: "2026-10-01T11:03",
      log_date: "2026-09-30",
      ours: ours_at("2026-10-01T03:02"),
      entries: [
        food("2026-09-29", "dinner", "sg:Nasi lemak (rice only)", { grams: 180 }),
        est("2026-09-29", "dinner", "Serunding fried chicken", 340, 25, 10, 22),
        food("2026-09-29", "dinner", "sg:Fried egg", { grams: 50 }),
        food("2026-09-29", "dinner", "sg:Ikan bilis and peanuts (Nasi lemak)", { servings: 1 }),
        food("2026-09-29", "dinner", "sg:Cucumber", { grams: 30 }),
        est("2026-09-30", "lunch", "Ebi Bar with extra meat, prawns and calamari", 1000, 57, 86, 45, 950),
        est("2026-09-30", "lunch", "Silken tofu with dried shrimp and fried shallots", 170, 14, 6, 9, 200),
        food("2026-09-30", "breakfast", "ours:chobani", { servings: 1 }),
        food("2026-09-30", "breakfast", "sg:Soft-boiled chicken egg, whole", { servings: 3 }),
      ],
      check_dates: ["2026-09-29", "2026-09-30", "2026-10-01"],
      expect: [
        kept("2026-09-29", "dinner", "nasi lemak"),
        kept("2026-09-29", "dinner", "serunding"),
        kept("2026-09-29", "dinner", "fried egg"),
        kept("2026-09-29", "dinner", "ikan bilis"),
        kept("2026-09-29", "dinner", "cucumber"),
        kept("2026-09-30", "lunch", "ebi bar"),
        kept("2026-09-30", "lunch", "tofu"),
        kept("2026-09-30", "breakfast", "chobani"),
        kept("2026-09-30", "breakfast", "egg"),
        Item("dumpling|pot ?sticker|gyoza|guo ?tie", "dinner", "2026-09-30", { kcal: [350, 650] }),
        Item("rib|chicken", "dinner", "2026-09-30", { kcal: [175, 190] }),
      ],
      foods: [
        FoodCheck("chicken rib", {
          kcal: [301.5, 302.5],
          protein_g: [12.4, 12.6],
          carb_g: [11.9, 12.1],
          fat_g: [22.6, 22.8],
          serving_grams: [[19, 21]],
          aliases_include: ["cp fried chicken rib"],
        }),
      ],
    },
  ),
  // Photo 37: protein bar label saved exactly and one bar logged. Label baseline.
  Case("prod_p37_protein_bar_label", ["photo", "label", B], [Msg("one of these", { photo: "photo37.jpg" })], {
    now: "2026-10-05T15:02",
    log_date: "2026-10-05",
    ours: ours_at("2026-10-05T07:01"),
    check_dates: ["2026-10-05"],
    expect: [Item("carman|bar", "snacks", { kcal: [194, 198] })],
    foods: [
      FoodCheck("carman|nut|bar", {
        kcal: [489, 491],
        protein_g: [25.8, 26.0],
        carb_g: [27.7, 27.9],
        fat_g: [28.9, 29.1],
        serving_grams: [[39, 41]],
      }),
    ],
  }),
  // --- meal photos ----------------------------------------------------------------
  // Photo 1: dense sesame tofu gelato linked to the watery "Black sesame paste" (-45%).
  Case(
    "prod_p01_black_sesame_tofu",
    ["photo", "meal", R, "near_name"],
    [Msg("black sesame tofu g", { photo: "photo01.jpg" })],
    {
      now: "2026-09-17T18:40",
      log_date: "2026-09-17",
      check_dates: ["2026-09-17"],
      expect: [Item("sesame", null)].concat(anything(null, 2)),
      total_kcal: [140, 260],
      ref_kcal: 200,
    },
  ),
  // Photo 5: restaurant unagi fried rice; the turn errored, nothing was logged.
  Case(
    "prod_p05_unagi_fried_rice",
    ["photo", "meal", R],
    [Msg("unagi fried rice", { photo: "photo05.jpg" })],
    {
      now: "2026-09-18T13:36",
      log_date: "2026-09-18",
      ours: ours_at("2026-09-18T05:36"),
      check_dates: ["2026-09-18"],
      expect: [Item("unagi|eel", "lunch")].concat(anything("lunch", 3)),
      total_kcal: ref_range(600),
      ref_kcal: 600,
    },
  ),
  // Photo 6: breakfast set; 2 eggs logged as 3.
  Case(
    "prod_p06_eggs_toast_soya_tea",
    ["photo", "meal", R, "photo_count"],
    [Msg("i ate this and the drink is ice soya tea", { photo: "photo06.jpg" })],
    {
      now: "2026-09-19T12:06",
      log_date: "2026-09-19",
      ours: ours_at("2026-09-19T04:06"),
      check_dates: ["2026-09-19"],
      expect: [
        Item("egg", null, { kcal: [115, 165] }),
        Item("toast|bread", null),
        Item("soy", null, { kcal: [70, 200] }),
      ].concat(anything(null, 2)),
      total_kcal: ref_range(495),
      ref_kcal: 495,
    },
  ),
  // Photo 8: char siew noodles plus extra siew yoke. Handled well.
  Case("prod_p08_roast_meat_noodles", ["photo", "meal", B], [Msg("", { photo: "photo08.jpg" })], {
    now: "2026-09-20T12:55",
    log_date: "2026-09-20",
    ours: ours_at("2026-09-20T04:55"),
    check_dates: ["2026-09-20"],
    expect: [
      Item("noodle|mee|char si", "lunch"),
      Item("siew yo|siu yuk|sio bak|roast(ed)? pork|pork belly", "lunch"),
    ].concat(anything("lunch", 4)),
    total_kcal: ref_range(870),
    ref_kcal: 870,
  }),
  // Photo 9: caifan sent at lunchtime with the app still on the previous day; logged on
  // the stale date with default scoops (+33%). The user had the entries moved to today.
  Case(
    "prod_p09_caifan_stale_date",
    ["photo", "meal", "dates", R, "stale_date", "default_serving"],
    [Msg("", { photo: "photo09.jpg" })],
    {
      now: "2026-09-20T12:57",
      log_date: "2026-09-19",
      ours: ours_at("2026-09-20T04:57"),
      entries: [
        food("2026-09-19", "breakfast", "sg:Soft-boiled chicken egg, whole", { servings: 2 }),
        food("2026-09-19", "breakfast", "sg:Toast (with butter)", { servings: 2 }),
        est("2026-09-19", "breakfast", "Iced soya tea (est.)", 200, 7, 27, 6),
      ],
      check_dates: ["2026-09-19", "2026-09-20"],
      expect: [
        kept("2026-09-19", "breakfast", "egg"),
        kept("2026-09-19", "breakfast", "toast"),
        kept("2026-09-19", "breakfast", "soya"),
        Item("rice", "lunch", "2026-09-20"),
        Item("pork", "lunch", "2026-09-20"),
        Item("egg", "lunch", "2026-09-20"),
      ].concat(anything("lunch", 3, "2026-09-20")),
      total_date: "2026-09-20",
      total_kcal: ref_range(690),
      ref_kcal: 690,
    },
  ),
  // Photo 10: nasi lemak breakfast; coconut rice logged as plain rice and the fried
  // chicken as a pork chop. Total close once corrected.
  Case(
    "prod_p10_nasi_lemak_breakfast",
    ["photo", "meal", R, "misidentified"],
    [Msg("breakfast", { photo: "photo10.jpg" })],
    {
      now: "2026-09-21T10:16",
      log_date: "2026-09-21",
      ours: ours_at("2026-09-21T02:16"),
      check_dates: ["2026-09-21"],
      expect: [
        Item("nasi lemak|coconut rice", "breakfast"),
        Item("chicken", "breakfast", { kcal: [250, 600] }),
      ].concat(anything("breakfast", 6)),
      forbid: ["pork"],
      total_kcal: ref_range(1155),
      ref_kcal: 1155,
    },
  ),
  // Photo 12: chicken and pork jowl don; the turn hung, but its logged 800 was fair.
  Case(
    "prod_p12_chicken_pork_don",
    ["photo", "meal", B],
    [Msg("chicken and pork don", { photo: "photo12.jpg" })],
    {
      now: "2026-09-22T12:32",
      log_date: "2026-09-22",
      ours: ours_at("2026-09-22T04:32"),
      check_dates: ["2026-09-22"],
      expect: [Item("don|chicken|pork|rice", "lunch")].concat(anything("lunch", 5)),
      total_kcal: ref_range(940),
      ref_kcal: 940,
    },
  ),
  // Photo 13: small silken tofu side added to the lunch already logged.
  Case(
    "prod_p13_tofu_side",
    ["photo", "meal", B],
    [Msg("and this tofu side too", { photo: "photo13.jpg" })],
    {
      now: "2026-09-22T12:40",
      log_date: "2026-09-22",
      ours: ours_at("2026-09-22T04:40"),
      entries: [est("2026-09-22", "lunch", "Chicken and pork don", 800, 40, 90, 28)],
      check_dates: ["2026-09-22"],
      expect: [Item("don", "lunch", { kcal: [799, 801] }), Item("tofu", "lunch", { kcal: [45, 110] })].concat(
        anything("lunch", 1),
      ),
      total_kcal: [845, 910],
    },
  ),
  // Photo 14: glazed chicken thigh and fries, grams judged. Handled well.
  Case("prod_p14_chicken_thigh_fries", ["photo", "meal", B], [Msg("", { photo: "photo14.jpg" })], {
    now: "2026-09-22T19:11",
    log_date: "2026-09-22",
    ours: ours_at("2026-09-22T11:11"),
    check_dates: ["2026-09-22"],
    expect: [Item("chicken|thigh", "dinner"), Item("fries|chips|potato", "dinner")].concat(
      anything("dinner", 2),
    ),
    total_kcal: ref_range(580),
    ref_kcal: 580,
  }),
  // Photos 15-16: fried hokkien prawn mee plus a tofu side, logged as the lighter
  // "Prawn noodles (dry)" at its default bowl, lard crisps missed (-39%).
  Case(
    "prod_p15_hokkien_mee_two_photos",
    ["photo", "meal", R, "near_name", "default_serving"],
    [Msg("ebi bar", { photos: ["photo15.jpg", "photo16.jpg"] })],
    {
      now: "2026-09-23T12:27",
      log_date: "2026-09-23",
      ours: ours_at("2026-09-23T04:27"),
      check_dates: ["2026-09-23"],
      expect: [Item("hokkien|mee|noodle", "lunch"), Item("tofu", "lunch", { kcal: [70, 250] })].concat(
        anything("lunch", 5),
      ),
      forbid: ["prawn noodles \\((dry|soup)\\)"],
      total_kcal: ref_range(1035),
      ref_kcal: 1035,
    },
  ),
  // Photo 17: dry char siew noodles and wanton soup, breakfast from text. Acceptable.
  Case(
    "prod_p17_char_siew_noodles_wanton_soup",
    ["photo", "meal", B],
    [Msg("dinner. and breakfast was the usual eggs and chobani", { photo: "photo17.jpg" })],
    {
      now: "2026-09-23T17:42",
      log_date: "2026-09-23",
      ours: ours_at("2026-09-23T09:42"),
      entries: [
        food("2026-09-23", "lunch", "sg:Prawn noodles (dry)", { grams: 400 }),
        est("2026-09-23", "lunch", "Grilled prawns and ikura topping", 130, 22, 1, 5),
        est("2026-09-23", "lunch", "Silken tofu with bonito and spring onion", 120, 9, 4, 6, 150),
      ],
      check_dates: ["2026-09-23"],
      expect: [
        kept("2026-09-23", "lunch", "prawn noodles"),
        kept("2026-09-23", "lunch", "prawns and ikura"),
        kept("2026-09-23", "lunch", "silken tofu"),
        Item("egg", "breakfast"),
        Item("chobani|yogurt", "breakfast", { ours: "chobani" }),
        Item("noodle|mee|char si", "dinner"),
        Item("wan ?ton|won ?ton|dumpling", "dinner"),
      ].concat(anything("dinner", 3)),
      total_meal: "dinner",
      total_kcal: ref_range(770),
      ref_kcal: 770,
    },
  ),
  // Photo 18: big chicken kebab plate with salad and garlic sauce. Handled well.
  Case(
    "prod_p18_chicken_kebab_plate",
    ["photo", "meal", B],
    [Msg("chicken kebab with salad. big", { photo: "photo18.jpg" })],
    {
      now: "2026-09-24T10:24",
      log_date: "2026-09-24",
      ours: ours_at("2026-09-24T02:24"),
      check_dates: ["2026-09-24"],
      expect: [Item("kebab|chicken|shawarma", null)].concat(anything(null, 3)),
      total_kcal: ref_range(880),
      ref_kcal: 880,
    },
  ),
  // Photo 19: chorizo and pork spaghetti; the turn hung, its logged 850 was in range.
  Case(
    "prod_p19_chorizo_spaghetti",
    ["photo", "meal", B],
    [Msg("chorizo and pork spaghetti for lunch", { photo: "photo19.jpg" })],
    {
      now: "2026-09-24T13:21",
      log_date: "2026-09-24",
      ours: ours_at("2026-09-24T05:21"),
      check_dates: ["2026-09-24"],
      expect: [Item("spaghetti|pasta|chorizo", "lunch")].concat(anything("lunch", 3)),
      total_kcal: ref_range(675),
      ref_kcal: 675,
    },
  ),
  // Photo 20: home unagi fried rice with chilli crisp; unagi read as "mushroom and meat
  // bits" and logged as egg fried rice (-21%). Reference assumes the 100 g of unagi the user
  // stated afterwards.
  Case(
    "prod_p20_home_unagi_fried_rice",
    ["photo", "meal", R, "misidentified"],
    [Msg("", { photo: "photo20.jpg" })],
    {
      now: "2026-09-24T19:10",
      log_date: "2026-09-24",
      ours: ours_at("2026-09-24T11:10"),
      check_dates: ["2026-09-24"],
      expect: [Item("unagi|eel", "dinner")].concat(anything("dinner", 4)),
      total_kcal: ref_range(865),
      ref_kcal: 865,
    },
  ),
  // Photo 21: generous steamed chicken rice logged at the default plate (-25%).
  Case(
    "prod_p21_steamed_chicken_rice",
    ["photo", "meal", R, "default_serving", "protein_undersized"],
    [Msg("", { photo: "photo21.jpg" })],
    {
      now: "2026-09-25T13:09",
      log_date: "2026-09-25",
      ours: ours_at("2026-09-25T05:09"),
      check_dates: ["2026-09-25"],
      expect: [Item("chicken", "lunch")].concat(anything("lunch", 3)),
      total_kcal: ref_range(640, 0.2),
      ref_kcal: 640,
    },
  ),
  // Photo 22: roasted chicken rice photo logged as plain white rice + chicken.
  Case(
    "prod_p22_roasted_chicken_rice_photo",
    ["photo", "meal", R, "near_name"],
    [Msg("", { photo: "photo22.jpg" })],
    {
      now: "2026-09-26T11:26",
      log_date: "2026-09-26",
      ours: ours_at("2026-09-26T03:26"),
      check_dates: ["2026-09-26"],
      expect: [Item("chicken rice", "lunch"), Item("soup", "lunch", { optional: true })].concat(
        anything("lunch", 2),
      ),
      forbid: ["white rice|cooked rice|plain rice"],
      total_kcal: ref_range(590),
      ref_kcal: 590,
    },
  ),
  // Photo 23: "little slice of cheesecake", logged at 80 g (+100%).
  Case(
    "prod_p23_little_cheesecake",
    ["photo", "meal", R, "small_portion"],
    [Msg("little slice of cheesecake", { photo: "photo23.jpg" })],
    {
      now: "2026-09-26T15:48",
      log_date: "2026-09-26",
      ours: ours_at("2026-09-26T07:48"),
      check_dates: ["2026-09-26"],
      expect: [Item("cheesecake", "snacks", { kcal: [95, 190] })],
      total_kcal: [95, 190],
      ref_kcal: 140,
    },
  ),
  // Photo 25: braised duck rice set at the default set (-12%). Acceptable.
  Case("prod_p25_duck_rice", ["photo", "meal", B], [Msg("duck rice", { photo: "photo25.jpg" })], {
    now: "2026-09-28T18:21",
    log_date: "2026-09-28",
    ours: ours_at("2026-09-28T10:21"),
    check_dates: ["2026-09-28"],
    expect: [Item("duck", "dinner")].concat(anything("dinner", 4)),
    total_kcal: ref_range(730),
    ref_kcal: 730,
  }),
  // Photo 26: user typed "roasted chicken rice"; logged white rice + chicken again,
  // three days after being corrected for the same thing (p22), and at 09:15 as lunch.
  Case(
    "prod_p26_roasted_chicken_rice_named",
    ["photo", "meal", R, "near_name"],
    [Msg("roasted chicken rice", { photo: "photo26.jpg" })],
    {
      now: "2026-09-29T09:15",
      log_date: "2026-09-29",
      ours: ours_at("2026-09-29T01:15"),
      check_dates: ["2026-09-29"],
      expect: [
        Item("roast(ed)? chicken rice", "breakfast"),
        Item("soup", "breakfast", { optional: true }),
      ].concat(anything("breakfast", 2)),
      forbid: ["white rice|cooked rice|plain rice"],
      total_kcal: ref_range(580),
      ref_kcal: 580,
    },
  ),
  // Photo 27: karaage set; six big pieces logged as ~200 g, rice low, salad skipped (-32%).
  Case(
    "prod_p27_karaage_set",
    ["photo", "meal", R, "protein_undersized"],
    [Msg("", { photo: "photo27.jpg" })],
    {
      now: "2026-09-29T12:17",
      log_date: "2026-09-29",
      ours: ours_at("2026-09-29T04:17"),
      check_dates: ["2026-09-29"],
      expect: [Item("karaage|fried chicken", "lunch", { kcal: [550, 1000] }), Item("rice", "lunch")].concat(
        anything("lunch", 7),
      ),
      total_kcal: ref_range(1160),
      ref_kcal: 1160,
    },
  ),
  // Photo 28: nasi lemak with a whole serunding chicken leg logged as one 150 g thigh.
  Case(
    "prod_p28_nasi_lemak_chicken_leg",
    ["photo", "meal", R, "protein_undersized"],
    [Msg("", { photo: "photo28.jpg" })],
    {
      now: "2026-09-29T19:08",
      log_date: "2026-09-29",
      ours: ours_at("2026-09-29T11:08"),
      check_dates: ["2026-09-29"],
      expect: [
        Item("chicken", "dinner", { kcal: [380, 750] }),
        Item("nasi lemak|coconut rice|rice", "dinner"),
      ].concat(anything("dinner", 6)),
      total_kcal: ref_range(1140),
      ref_kcal: 1140,
    },
  ),
  // Photo 29: "save this as ebi bar" for last week's meal (23 Sep). It never looked
  // up last week, saved a prawn noodle soup guess, and the photo fix left food and entry ~40% low.
  // Took six turns and the saved food stayed wrong.
  Case(
    "prod_p29_save_as_ebi_bar",
    ["photo", "meal", "multi_turn", R, "save_as"],
    [
      Msg(
        "today's lunch is the large portion prawn noodles and tofu side from last week. you can save this as ebi bar",
      ),
      Msg("here's a photo to help you", { photo: "photo29.jpg" }),
    ],
    {
      now: "2026-09-30T13:05",
      log_date: "2026-09-30",
      ours: ours_at("2026-09-30T05:04"),
      entries: [
        food("2026-09-23", "lunch", "sg:Prawn noodles (dry)", { grams: 400 }),
        est("2026-09-23", "lunch", "Grilled prawns and ikura topping", 130, 22, 1, 5),
        est("2026-09-23", "lunch", "Silken tofu with bonito and spring onion", 120, 9, 4, 6, 150),
      ],
      check_dates: ["2026-09-23", "2026-09-30"],
      expect: [
        kept("2026-09-23", "lunch", "prawn noodles"),
        kept("2026-09-23", "lunch", "prawns and ikura"),
        kept("2026-09-23", "lunch", "silken tofu"),
        Item("ebi|hokkien|mee|noodle", "lunch"),
      ].concat(anything("lunch", 3)),
      forbid: ["soup"],
      foods: [FoodCheck("ebi bar", { serving_kcal: [750, 1450], aliases_include: ["ebi bar"] })],
      total_kcal: ref_range(1080),
      ref_kcal: 1080,
    },
  ),
  // Photo 30: same photo; "edit the ebi bar entry and today's entry". It edited neither:
  // added a tofu side and left the saved food at 642 kcal.
  Case(
    "prod_p30_edit_food_and_entry",
    ["photo", "meal", R, "save_as", "instruction"],
    [
      Msg(
        "this is Ebi Bar. it's a big portion of hokkien mee with a tofu side. there's meat, prawns, calamari in the noodles too. edit the ebi bar entry and today's entry",
        { photo: "photo30.jpg" },
      ),
    ],
    {
      now: "2026-09-30T13:08",
      log_date: "2026-09-30",
      ours: ours_at("2026-09-30T05:08"),
      entries: [
        est("2026-09-30", "lunch", "Ebi Bar with extra meat, prawns and calamari", 900, 57, 86, 33, 950),
      ],
      check_dates: ["2026-09-30"],
      expect: [Item("ebi|hokkien|mee|noodle", "lunch", { kcal: [650, 1450] })].concat(anything("lunch", 3)),
      foods: [FoodCheck("ebi bar", { serving_kcal: [850, 1450] })],
      total_kcal: ref_range(1080),
      ref_kcal: 1080,
    },
  ),
  // Photo 32: beef pho with a side of extra beef. Handled well.
  Case("prod_p32_pho_extra_beef", ["photo", "meal", B], [Msg("pho, extra beef", { photo: "photo32.jpg" })], {
    now: "2026-10-01T13:01",
    log_date: "2026-10-01",
    ours: ours_at("2026-10-01T05:01"),
    check_dates: ["2026-10-01"],
    expect: [Item("pho|beef", "lunch")].concat(anything("lunch", 4)),
    total_kcal: ref_range(705),
    ref_kcal: 705,
  }),
  // Photo 34: dry bak chor mee estimated as "Dry pork noodles with liver and
  // meatball" because the DB dish supposedly lacks them; on "there's no bak chor mee in the db?"
  // it asked instead of fixing the entry.
  Case(
    "prod_p34_bak_chor_mee",
    ["photo", "meal", "multi_turn", R, "near_name"],
    [Msg("", { photo: "photo34.jpg" }), Msg("there's no bak chor mee in the db?")],
    {
      now: "2026-10-02T13:18",
      log_date: "2026-10-02",
      ours: ours_at("2026-10-02T05:18"),
      check_dates: ["2026-10-02"],
      expect: [Item("bak chor mee", "lunch", { from_first_turn: true })].concat(anything("lunch", 2)),
      total_kcal: ref_range(640),
      ref_kcal: 640,
    },
  ),
  // Photo 35: 2 pancakes and 3 rashers over-logged (+29%) and an empty log_entries call.
  Case(
    "prod_p35_pancakes_bacon",
    ["photo", "meal", R, "small_portion", "tool_errors"],
    [Msg("", { photo: "photo35.jpg" })],
    {
      now: "2026-10-04T09:49",
      log_date: "2026-10-04",
      ours: ours_at("2026-10-04T01:49"),
      check_dates: ["2026-10-04"],
      expect: [
        Item("pancake", "breakfast", { kcal: [180, 320] }),
        Item("egg", "breakfast", { kcal: [80, 200] }),
        Item("bacon", "breakfast", { kcal: [100, 260] }),
      ].concat(anything("breakfast", 2)),
      total_kcal: ref_range(670, 0.25),
      ref_kcal: 670,
      max_tool_errors: 0,
    },
  ),
  // Photo 36: a shared table for four logged as one person's plate (+98%), the bottled
  // tea priced as bubble-tea green tea. Reference is one share, half an egg, a little rice.
  Case(
    "prod_p36_shared_indian_table",
    ["photo", "meal", R, "shared"],
    [Msg("my dinner, its all indian food and the drink is pokka green tea", { photo: "photo36.jpg" })],
    {
      now: "2026-10-05T08:48",
      log_date: "2026-10-04",
      ours: ours_at("2026-10-05T00:48"),
      check_dates: ["2026-10-04", "2026-10-05"],
      expect: [Item("tea|pokka", "dinner", { kcal: [0, 90] })].concat(anything("dinner", 12)),
      total_kcal: [650, 1500],
      ref_kcal: 1040,
    },
  ),
  // Photo 38: roasted chicken rice with extra chicken. Handled well.
  Case(
    "prod_p38_roasted_chicken_rice_extra",
    ["photo", "meal", B],
    [
      Msg("this is the holland v roasted chicken rice, but I asked for extra chicken today", {
        photo: "photo38.jpg",
      }),
    ],
    {
      now: "2026-10-06T09:59",
      log_date: "2026-10-06",
      ours: ours_at("2026-10-06T01:59"),
      check_dates: ["2026-10-06"],
      expect: [Item("roast(ed)? chicken rice", null)].concat(anything(null, 3)),
      forbid: ["white rice|cooked rice|plain rice"],
      total_kcal: ref_range(760),
      ref_kcal: 760,
    },
  ),
  // Photo 39: ayam bakar set, every component found (+2%). Handled well.
  Case("prod_p39_ayam_bakar", ["photo", "meal", B], [Msg("ayam bakar", { photo: "photo39.jpg" })], {
    now: "2026-10-06T13:26",
    log_date: "2026-10-06",
    ours: ours_at("2026-10-06T05:26"),
    check_dates: ["2026-10-06"],
    expect: [Item("ayam|chicken", "lunch"), Item("rice", "lunch")].concat(anything("lunch", 8)),
    total_kcal: ref_range(870),
    ref_kcal: 870,
  }),
  // --- text ------------------------------------------------------------------------
  // "it's a very big portion" after the photo-34 log; read as a reduction (400 -> 220 g).
  Case("prod_t35_very_big_portion", ["text", "edit", R, "portion"], [Msg("it's a very big portion")], {
    now: "2026-09-23T12:29",
    log_date: "2026-09-23",
    ours: ours_at("2026-09-23T04:29"),
    entries: [
      food("2026-09-23", "lunch", "sg:Prawn noodles (dry)", { servings: 1 }),
      est("2026-09-23", "lunch", "Grilled prawns and ikura topping", 130, 22, 1, 5),
      est("2026-09-23", "lunch", "Silken tofu with bonito and spring onion", 120, 9, 4, 6, 150),
    ],
    check_dates: ["2026-09-23"],
    expect: [
      Item("noodle|mee", "lunch", { kcal: [500, 1300] }),
      Item("prawns and ikura", "lunch", { kcal: [130, 260] }),
      Item("tofu", "lunch", { kcal: [120, 200] }),
    ],
  }),
  // today's matcha latte dropped (only Friday's logged), packaged can used for a
  // latte, and an invalid tool field (meal_note) cost a retry.
  Case(
    "prod_t52_matcha_two_days",
    ["text", "dates", R, "instruction", "tool_errors"],
    [
      Msg(
        "breakfast today was chobani and a matcha latte. actually I drank a match latte on Friday too. lunch was half a bowl of rice, two honey glaze chicken wings, some tofu",
      ),
    ],
    {
      now: "2026-09-27T15:16",
      log_date: "2026-09-27",
      ours: ours_at("2026-09-27T07:16"),
      check_dates: ["2026-09-25", "2026-09-27"],
      expect: [
        Item("chobani|yogurt", "breakfast", { ours: "chobani" }),
        Item("matcha", "breakfast", { kcal: [90, 250] }),
        Item("matcha", null, { date: "2026-09-25", kcal: [90, 250] }),
        Item("rice", "lunch", { kcal: [100, 170] }),
        Item("wing", "lunch", { kcal: [150, 400] }),
        Item("tofu", "lunch", { kcal: [30, 200] }),
      ],
      forbid: ["packaged|3 in 1"],
      max_tool_errors: 0,
    },
  ),
  // hot plate tofu; "egg tofu" linked to "Steamed egg with tofu", "prawn" search hit
  // prawn dishes. Logged just after midnight, still for the previous day's dinner.
  Case(
    "prod_t53_hot_plate_tofu",
    ["text", R, "search", "near_name"],
    [
      Msg(
        "dinner today was a homemade hot plate tofu. 150g mince pork, 4 small prawns, 150g egg tofu, some mushrooms, cauliflower, bowl of rice.",
      ),
    ],
    {
      now: "2026-09-28T00:38",
      log_date: "2026-09-27",
      ours: ours_at("2026-09-27T16:38"),
      check_dates: ["2026-09-27", "2026-09-28"],
      expect: [
        Item("pork", "dinner", { kcal: [250, 480] }),
        Item("prawn|shrimp", "dinner", { kcal: [20, 110] }),
        Item("egg tofu|tofu", "dinner", { kcal: [80, 180] }),
        Item("rice", "dinner", { kcal: [200, 340] }),
      ].concat(anything("dinner", 5)),
      strict_count: false,
      forbid: ["steamed egg|prawn noodle|mock prawn|assam"],
      total_kcal: [600, 1200],
    },
  ),
  // yong tau foo; "half a portion of maggie" (instant noodles) linked to mee goreng.
  Case(
    "prod_t56_yong_tau_foo_maggi",
    ["text", R, "near_name", "search"],
    [
      Msg(
        "lunch today was a yong tau foo: 6 fishballs, 4 fuzhou fishballs, 2 cheese tofu, 3 pieces of tau kee, half a portion of maggie",
      ),
    ],
    {
      now: "2026-09-28T18:58",
      log_date: "2026-09-28",
      ours: ours_at("2026-09-28T10:58"),
      check_dates: ["2026-09-28"],
      expect: [Item("magg|instant|noodle", "lunch", { kcal: [130, 280] })].concat(anything("lunch", 6)),
      strict_count: false,
      forbid: ["goreng"],
      total_kcal: [450, 1050],
    },
  ),
  // "naibai" (the vegetable) read as a milk drink, two searches and a get_entries;
  // after correction, boiled cabbage at 19 kcal instead of the hawker stir-fried veg.
  Case(
    "prod_t76_naibai",
    ["text", R, "search", "tool_calls"],
    [Msg("dinner was hainanese chicken rice, steamed chicken. and a naibai")],
    {
      now: "2026-10-03T22:45",
      log_date: "2026-10-03",
      ours: ours_at("2026-10-03T14:45"),
      entries: [
        food("2026-10-03", "breakfast", "sg:Kopi C kosong", { servings: 1 }),
        food("2026-10-03", "breakfast", "sg:Kaya and butter toast", { servings: 1 }),
        food("2026-10-03", "breakfast", "sg:Soft-boiled chicken egg, whole", { servings: 2 }),
      ],
      check_dates: ["2026-10-03"],
      expect: [
        kept("2026-10-03", "breakfast", "kopi"),
        kept("2026-10-03", "breakfast", "kaya"),
        kept("2026-10-03", "breakfast", "egg"),
        Item("chicken rice", "dinner", { kcal: [400, 700] }),
        Item("nai ?bai|cabbage|bok ?choy|veg", "dinner", { kcal: [30, 150] }),
      ],
      forbid: ["milk|teh|drink"],
      max_tool_calls: 3,
      reply_forbid: ["\\d+\\s*kcal"],
    },
  ),
  // "steamed chicken rice for dinner yesterday" sent the morning after, with the app
  // still on yesterday; logged two days back.
  Case(
    "prod_t80_yesterday_on_yesterday",
    ["text", "dates", R, "stale_date"],
    [Msg("steamed chicken rice for dinner yesterday")],
    {
      now: "2026-10-04T09:50",
      log_date: "2026-10-03",
      ours: ours_at("2026-10-04T01:50"),
      entries: [
        food("2026-10-03", "breakfast", "sg:Kaya and butter toast", { servings: 1 }),
        food("2026-10-03", "breakfast", "sg:Soft-boiled chicken egg, whole", { servings: 2 }),
        est("2026-10-03", "breakfast", "Soya teh kosong", 63, 3, 5, 3),
      ],
      check_dates: ["2026-10-02", "2026-10-03", "2026-10-04"],
      expect: [
        kept("2026-10-03", "breakfast", "kaya"),
        kept("2026-10-03", "breakfast", "egg"),
        kept("2026-10-03", "breakfast", "soya"),
        Item("chicken rice", "dinner", "2026-10-03", { kcal: [400, 700] }),
      ],
    },
  ),
  // "a cup of matcha latte" linked to a 3-in-1 sachet mix.
  Case(
    "prod_t82_cup_of_matcha_latte",
    ["text", R, "near_name"],
    [Msg("and a cup of matcha latte for breakfast")],
    {
      now: "2026-10-04T09:52",
      log_date: "2026-10-04",
      ours: ours_at("2026-10-04T01:52"),
      entries: [
        food("2026-10-04", "breakfast", "sg:Pancakes (plain)", { servings: 3 }),
        food("2026-10-04", "breakfast", "sg:Fried bacon", { servings: 4 }),
        food("2026-10-04", "breakfast", "sg:Scrambled egg", { serving: "1 plate" }),
      ],
      check_dates: ["2026-10-04"],
      expect: [
        kept("2026-10-04", "breakfast", "pancake"),
        kept("2026-10-04", "breakfast", "bacon"),
        kept("2026-10-04", "breakfast", "scrambled"),
        Item("matcha", "breakfast", { kcal: [90, 250] }),
      ],
      forbid: ["3 in 1|packaged"],
    },
  ),
  // "half boiled egg was half portion only, the rest was split into 4 portion" on the
  // shared dinner: it set the egg to 1 (later 0.5) and never applied the four-way split.
  Case(
    "prod_t88_split_into_4",
    ["text", "edit", R, "split", "instruction"],
    [Msg("half boiled egg was half portion only, the rest was split into 4 portion")],
    {
      now: "2026-10-05T08:50",
      log_date: "2026-10-04",
      ours: ours_at("2026-10-05T00:50"),
      entries: [
        food("2026-10-04", "breakfast", "sg:Pancakes (plain)", { servings: 1.5 }),
        food("2026-10-04", "breakfast", "sg:Fried bacon", { servings: 2 }),
        food("2026-10-04", "breakfast", "sg:Scrambled egg", { serving: "1 plate", servings: 0.5 }),
        est("2026-10-04", "breakfast", "Unsweetened matcha latte with oat milk", 137, 4, 12, 7, 200),
        food("2026-10-04", "dinner", "sg:Mutton curry (dry)", { grams: 120, name: "Dry mutton fry" }),
        food("2026-10-04", "dinner", "sg:Mutton curry", { grams: 150 }),
        est("2026-10-04", "dinner", "Palak saag (spinach curry)", 180, 5, 8, 14),
        food("2026-10-04", "dinner", "sg:Cooked white rice", { grams: 150, name: "Basmati rice, steamed" }),
        food("2026-10-04", "dinner", "sg:Tandoori chicken", { grams: 150 }),
        food("2026-10-04", "dinner", "sg:Hard-boiled chicken egg, whole", { servings: 2 }),
        food("2026-10-04", "dinner", "sg:Stir fried cabbage", {
          grams: 120,
          name: "Cabbage and carrot poriyal",
        }),
        food("2026-10-04", "dinner", "sg:Chapati", { grams: 120, name: "Roti" }),
        food("2026-10-04", "dinner", "sg:Raita", { grams: 150 }),
        food("2026-10-04", "dinner", "sg:Green tea", { grams: 350, name: "Pokka green tea" }),
      ],
      check_dates: ["2026-10-04"],
      expect: [
        kept("2026-10-04", "breakfast", "pancake"),
        kept("2026-10-04", "breakfast", "bacon"),
        kept("2026-10-04", "breakfast", "scrambled"),
        kept("2026-10-04", "breakfast", "matcha"),
        Item("mutton fry|dry", "dinner", { kcal: [45, 70] }),
        Item("mutton curry", "dinner", { kcal: [55, 85] }),
        Item("saag|spinach", "dinner", { kcal: [35, 56] }),
        Item("rice", "dinner", { kcal: [39, 61] }),
        Item("tandoori", "dinner", { kcal: [49, 77] }),
        Item("egg", "dinner", { kcal: [30, 45] }),
        Item("cabbage|poriyal", "dinner", { kcal: [32, 50] }),
        Item("roti|chapati", "dinner", { kcal: [78, 122] }),
        Item("raita", "dinner", { kcal: [23, 37] }),
        Item("tea", "dinner", { kcal: [25, 125] }),
      ],
      total_meal: "dinner",
      total_kcal: [430, 680],
      reply_forbid: ["\\d+\\s*kcal"],
    },
  ),
  // "half a bowl of briyani" logged as half the 710 g DB plate (532 kcal).
  Case(
    "prod_t92_half_bowl_briyani",
    ["text", R, "default_serving"],
    [Msg("yesterday's dinner was a paneer prata, half a bowl of briyani, some curry. some chips too")],
    {
      now: "2026-10-05T10:59",
      log_date: "2026-10-04",
      ours: ours_at("2026-10-05T02:59"),
      check_dates: ["2026-10-03", "2026-10-04", "2026-10-05"],
      expect: [
        Item("prata", "dinner", "2026-10-04", { kcal: [250, 550] }),
        Item("briyani|biryani", "dinner", "2026-10-04", { kcal: [150, 380] }),
        Item("curry", "dinner", "2026-10-04", { kcal: [50, 320] }),
        Item("chip|crisp", "dinner", "2026-10-04", { kcal: [50, 300] }),
      ],
    },
  ),
  // a chain bakery's floss bun logged as the generic 65 g bun (~30% low).
  Case("prod_t96_bakery_floss_bun", ["text", R, "default_serving"], [Msg("bread talk pork floss bun")], {
    now: "2026-10-05T16:55",
    log_date: "2026-10-05",
    ours: ours_at("2026-10-05T08:55"),
    check_dates: ["2026-10-05"],
    expect: [Item("floss", "snacks", { kcal: [300, 460] })],
  }),
  // "prawn" search returned prawn noodles, "fried chicken drumlet" returned the
  // household chicken rib first; drumlet estimated ~2x, fried pork linked to a lean pork chop.
  Case(
    "prod_t97_drumlet_prawn_pork",
    ["text", R, "search", "ours_outranks"],
    [Msg("half a bowl of rice, 1 prawn, 1 fried chicken drumlet, 80g fried pork")],
    {
      now: "2026-10-05T19:12",
      log_date: "2026-10-05",
      ours: ours_at("2026-10-05T11:12"),
      check_dates: ["2026-10-05"],
      expect: [
        Item("rice", "dinner", { kcal: [100, 170] }),
        Item("prawn|shrimp", "dinner", { kcal: [10, 50] }),
        Item("drumlet|chicken", "dinner", { kcal: [60, 140], not_ours: "cp_rib" }),
        Item("pork", "dinner", { kcal: [150, 320] }),
      ],
      forbid: ["prawn noodle|mock prawn|assam|chicken rib"],
      reply_forbid: ["\\d+\\s*kcal"],
    },
  ),
  // "tau pok" searched to poke bowls first (it estimated, but on the high side).
  Case("prod_t98_tau_pok", ["text", R, "search"], [Msg("2 pieces of tau pok")], {
    now: "2026-10-05T19:12",
    log_date: "2026-10-05",
    ours: ours_at("2026-10-05T11:12"),
    entries: [
      food("2026-10-05", "dinner", "sg:Cooked white rice", { servings: 0.5 }),
      est("2026-10-05", "dinner", "Prawn (1 piece)", 20, 4, 0, 0.5, 20),
      est("2026-10-05", "dinner", "Fried chicken drumlet", 190, 15, 6, 12, 70),
      food("2026-10-05", "dinner", "sg:Fried pork chop", { grams: 80 }),
    ],
    check_dates: ["2026-10-05"],
    expect: [
      kept("2026-10-05", "dinner", "rice"),
      kept("2026-10-05", "dinner", "prawn"),
      kept("2026-10-05", "dinner", "drumlet"),
      kept("2026-10-05", "dinner", "pork chop"),
      Item("tau ?pok|bean ?curd|tofu puff", "dinner", { kcal: [50, 180] }),
    ],
    forbid: ["pok[eé]"],
  }),
];
