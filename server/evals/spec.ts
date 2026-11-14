/** The case format: messages, expected entries and household foods, and the default dates. */

export const TODAY = "2026-10-21";
export const YESTERDAY = "2026-10-20";
export const DAY_BEFORE = "2026-10-19";
export const EVENING = "2026-10-21T21:30";
export const MORNING = "2026-10-21T09:40";

export type Range = [number, number];

export interface Msg {
  text: string;
  photo: string | null;
  /** Several photos in one message, in order. */
  photos: string[];
}

export function Msg(text: string, options: Partial<Omit<Msg, "text">> = {}): Msg {
  return { text, photo: null, photos: [], ...options };
}

export const photosOf = (msg: Msg): string[] => [...(msg.photo ? [msg.photo] : []), ...msg.photos];

/** An entry expected in the log after the case. `name` is a regular expression on the entry name. */
export interface Item {
  name: string;
  meal: string | null;
  /** Defaults to the case's log date. */
  date: string | null;
  kcal: Range | null;
  ours: string | null;
  not_ours: string | null;
  optional: boolean;
  /** Must be an entry that already existed after the first message (edited in place, not re-added). */
  from_first_turn: boolean;
}

type ItemOptions = Partial<Omit<Item, "name">>;

/** `Item(name, meal?, date?, options?)`: the meal and date may be given in order, the rest by name. */
export function Item(name: string, ...rest: (string | null | ItemOptions)[]): Item {
  const last = rest.at(-1);
  const options = last !== null && typeof last === "object" ? (rest.pop() as ItemOptions) : {};
  const [meal = null, date = null] = rest as (string | null)[];
  return {
    name,
    meal,
    date,
    kcal: null,
    ours: null,
    not_ours: null,
    optional: false,
    from_first_turn: false,
    ...options,
  };
}

/** A household food expected after the case. Ranges are per 100 g. */
export interface FoodCheck {
  name: string;
  kcal: Range | null;
  protein_g: Range | null;
  carb_g: Range | null;
  fat_g: Range | null;
  /** At least one serving in one of these ranges. */
  serving_grams: Range[] | null;
  aliases_include: string[];
  aliases_exclude: string[];
  /** kcal of the default serving. */
  serving_kcal: Range | null;
}

export function FoodCheck(name: string, options: Partial<Omit<FoodCheck, "name">> = {}): FoodCheck {
  return {
    name,
    kcal: null,
    protein_g: null,
    carb_g: null,
    fat_g: null,
    serving_grams: null,
    aliases_include: [],
    aliases_exclude: [],
    serving_kcal: null,
    ...options,
  };
}

/** A household food to seed. `key` is how the case's expectations refer to it. */
export interface OursSpec {
  key: string;
  name: string;
  brand?: string | null;
  nutrients: Record<string, number>;
  servings: { label: string; grams: number; default?: boolean }[];
  aliases: string[];
  /** When it was saved (UTC), for cases from real use. */
  created?: string;
}

/** A log entry to seed: a database food by `ref` ("sg:Name" | "usda:Name" | "ours:key"), or an estimate. */
export interface EntrySpec {
  date: string;
  meal: string;
  ref?: string | null;
  servings?: number | null;
  serving?: string | null;
  grams?: number | null;
  name?: string | null;
  kcal?: number | null;
  protein_g?: number | null;
  carb_g?: number | null;
  fat_g?: number | null;
}

/** The short form: [date, meal, food ref, servings]. */
export type EntryTuple = [string, string, string, number | null];

export interface Case {
  id: string;
  tags: string[];
  msgs: Msg[];
  now: string;
  log_date: string;
  ours: OursSpec[];
  entries: (EntryTuple | EntrySpec)[];
  /** The complete log for the checked dates. */
  expect: Item[] | null;
  check_dates: string[];
  /** On total_date. */
  total_kcal: Range | null;
  /** Defaults to log_date. */
  total_date: string | null;
  /** Count only this meal in total_kcal and ref_kcal. */
  total_meal: string | null;
  /** Benchmark estimate for photo cases. */
  ref_kcal: number | null;
  foods: FoodCheck[];
  /** The reply must state the day's protein total. */
  reply_protein: boolean;
  /** How much the log date's kcal total must fall between the first message and the end. */
  total_drop: Range | null;
  /** No entry on the checked dates may match these. */
  forbid: string[];
  /** False: extra entries are fine (photo meals split into any number of parts). */
  strict_count: boolean;
  /** Over every message of the case. */
  max_tool_calls: number | null;
  /** Tool calls rejected as invalid or failed. */
  max_tool_errors: number | null;
  /** Regular expressions the last reply must not match. */
  reply_forbid: string[];
}

export function Case(
  id: string,
  tags: string[],
  msgs: Msg[],
  options: Partial<Omit<Case, "id" | "tags" | "msgs">> = {},
): Case {
  return {
    id,
    tags,
    msgs,
    now: EVENING,
    log_date: TODAY,
    ours: [],
    entries: [],
    expect: null,
    check_dates: [TODAY],
    total_kcal: null,
    total_date: null,
    total_meal: null,
    ref_kcal: null,
    foods: [],
    reply_protein: false,
    total_drop: null,
    forbid: [],
    strict_count: true,
    max_tool_calls: null,
    max_tool_errors: null,
    reply_forbid: [],
    ...options,
  };
}
