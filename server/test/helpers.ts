/** A Bao with a five-food reference set and a scripted Claude, for tests without the network. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { eq } from "drizzle-orm";
import {
  type AgentClient,
  configFromEnv,
  devUser,
  envSchema,
  type Notification,
  type PushSubscription,
  type User,
} from "warren/server";
import { createBao } from "../src/app.js";
import { loadReference } from "../src/foods.js";
import { foods } from "../src/schema.js";

const per100 = (kcal: number, protein_g: number, carb_g: number, fat_g: number, rest: object = {}) => ({
  kcal, protein_g, carb_g, fat_g, fibre_g: 0, sugar_g: 0, sodium_mg: 0, sat_fat_g: 0, ...rest,
});

export const REFERENCE = [
  { source: "sgfoodid", source_ref: "F05060073", name: "Laksa", description: "Rice vermicelli in coconut gravy",
    category: "Grains and staples / Noodle/Pasta-based dishes", per_100g: per100(69, 3.31, 6.94, 2.95, { sodium_mg: 511 }),
    servings: [{ label: "bowl", grams: 604, default: true }] },
  { source: "sgfoodid", source_ref: "F09000001", name: "Kopi C", category: "Beverages",
    per_100g: per100(43, 1.2, 7.0, 1.1, { fibre_g: null }), servings: [{ label: "cup", grams: 250, default: true }] },
  { source: "sgfoodid", source_ref: "F05010001", name: "Kaya toast", category: "Grains", per_100g: per100(330, 6, 45, 14),
    servings: [{ label: "slice", grams: 45, default: true }, { label: "set", grams: 135, default: false }] },
  { source: "usda", source_ref: "170903", name: "Yogurt, Greek, plain, nonfat", category: "Dairy",
    per_100g: per100(59, 10.2, 3.6, 0.4), servings: [{ label: "container", grams: 170, default: true }] },
  { source: "usda", source_ref: "171287", name: "Egg, whole, raw, fresh", category: "Eggs",
    per_100g: per100(143, 12.6, 0.7, 9.5), servings: [{ label: "large", grams: 50, default: true }] },
];

export function referenceDir(records: object[] = REFERENCE, aliases?: object): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bao-ref-"));
  fs.writeFileSync(path.join(dir, "fixture.jsonl.gz"), zlib.gzipSync(records.map((r) => JSON.stringify(r)).join("\n")));
  if (aliases) fs.writeFileSync(path.join(dir, "aliases.json"), JSON.stringify(aliases));
  return dir;
}

export interface Pushed {
  endpoint: string;
  message: Notification;
}

export function testBao(options: { anthropic?: AgentClient; env?: Record<string, string>; reference?: string } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bao-test-"));
  const pushed: Pushed[] = [];
  const gone = new Set<string>();
  const reference = options.reference ?? referenceDir();
  const app = createBao({
    config: configFromEnv(
      envSchema.parse({
        DATA_DIR: path.join(dir, "data"),
        STATIC_DIR: path.join(dir, "static"),
        PUBLIC_URL: "http://localhost:8000",
        DEV_LOGIN: "true",
        SCHEDULER: "false",
        TIMEZONE: "Asia/Singapore",
        AGENT_MODEL: "claude-haiku-5-5",
        APP_VERSION: "9.9.9",
        ...options.env,
      }),
    ),
    referenceDir: reference,
    anthropic: options.anthropic,
    pushSender: async (sub: PushSubscription, message: Notification) => {
      if (gone.has(sub.endpoint)) throw new (await import("warren/server")).Gone();
      pushed.push({ endpoint: sub.endpoint, message });
    },
  });
  loadReference(app.db, reference);
  const foodId = (name: string): number =>
    app.db.select({ id: foods.id }).from(foods).where(eq(foods.name, name)).get()!.id;
  const user = (name: string): User => devUser(app.db, name);

  const json = { "content-type": "application/json", "x-warren": "1" };
  /** A signed-in browser: `req(method, url, body)` returns the response. */
  const as = async (name: string) => {
    const res = await app.http.request("/api/auth/dev-login", { method: "POST", headers: json, body: JSON.stringify({ name }) });
    const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
    const req = (method: string, url: string, body?: unknown) =>
      app.http.request(url, { method, headers: { ...json, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    return {
      req,
      cookie,
      get: async (url: string) => (await req("GET", url)).json() as Promise<any>,
      post: async (url: string, body?: unknown) => (await req("POST", url, body ?? {})).json() as Promise<any>,
    };
  };
  return { app, db: app.db, foodId, user, as, pushed, gone, reference };
}

// --- a scripted Claude ----------------------------------------------------------------------------

type Block = Record<string, unknown>;

export function message(content: Block[], stop = "end_turn") {
  return {
    id: "msg_x", type: "message", role: "assistant", model: "claude-haiku-5-5", content,
    stop_reason: stop, stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 50 },
  };
}
export const say = (text: string) => message([{ type: "text", text }]);
export const use = (id: string, name: string, input: unknown) => message([{ type: "tool_use", id, name, input }], "tool_use");

/** Replays scripted responses and records each request as it was sent. */
export class FakeClaude implements AgentClient {
  requests: Record<string, any>[] = [];
  constructor(private responses: ReturnType<typeof message>[]) {}
  beta = {
    messages: {
      stream: (params: Record<string, unknown>) => {
        this.requests.push(structuredClone(params));
        const next = this.responses.shift();
        if (!next) throw new Error("FakeClaude ran out of responses");
        return {
          async *[Symbol.asyncIterator]() {},
          finalMessage: async () => next as never,
        };
      },
    },
  };
}

/** Send one message to the agent through the API and collect the events. */
export async function turn(
  bao: ReturnType<typeof testBao>,
  browser: Awaited<ReturnType<ReturnType<typeof testBao>["as"]>>,
  text: string,
  options: { day?: string; threadId?: number; fileIds?: number[] } = {},
): Promise<any[]> {
  const res = await browser.req("POST", "/api/agent/turns", {
    scope: options.day ?? "2026-03-03",
    text,
    thread_id: options.threadId ?? null,
    file_ids: options.fileIds ?? [],
  });
  if (res.status !== 200) throw new Error(`turn failed: ${res.status} ${await res.text()}`);
  return (await res.text()).split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
}
