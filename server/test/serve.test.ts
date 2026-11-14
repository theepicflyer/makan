import net from "node:net";
import { afterAll, beforeAll, expect, test } from "vitest";
import * as logSvc from "../src/log.js";
import { testBao } from "./helpers.js";

let bao: ReturnType<typeof testBao>;
let base: string;

beforeAll(async () => {
  const port = await new Promise<number>((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
  bao = testBao({ env: { PORT: String(port), HOST: "127.0.0.1", MCP_DEV_USER: "Alice" } });
  base = `http://127.0.0.1:${port}`;
  await bao.app.start();
});
afterAll(() => bao.app.stop());

async function mcp(method: string, params: unknown) {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const text = await res.text();
  return JSON.parse(text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5)).join("") || text);
}
const call = async (name: string, args: unknown = {}) => {
  const out = await mcp("tools/call", { name, arguments: args });
  return { error: Boolean(out.result?.isError), data: out.result?.isError ? out.result.content[0].text : JSON.parse(out.result.content[0].text) };
};

test("MCP clients get the five read-only tools, not the agent's", async () => {
  const tools = (await mcp("tools/list", {})).result.tools;
  expect(tools.map((t: any) => t.name)).toEqual(["get_daily_totals", "get_food_log", "get_profile", "list_household_foods", "search_foods"]);
  expect(tools.every((t: any) => t.annotations.readOnlyHint)).toBe(true);
  expect(tools.find((t: any) => t.name === "search_foods").inputSchema.properties.query.description).toContain("laksa");
  expect((await (await fetch(`${base}/api/health`)).json()).app).toBe("bao");
});

test("the tools read the signed-in person's log", async () => {
  const alice = bao.user("Alice");
  logSvc.setTargets(bao.db, alice, { kcal: 1800 });
  logSvc.addEntry(bao.db, alice, { day: "2026-10-21", meal: "lunch", food_id: bao.foodId("Laksa") });
  logSvc.addEntry(bao.db, alice, { day: "2026-10-21", meal: "snacks", name: "Bun", nutrients: { kcal: 200 }, note: "shared" });
  logSvc.addEntry(bao.db, bao.user("Bob"), { day: "2026-10-21", meal: "lunch", food_id: bao.foodId("Kopi C") });

  const profile = (await call("get_profile")).data;
  expect(profile).toMatchObject({ name: "Alice", targets_per_day: { kcal: 1800 }, timezone: "Asia/Singapore", meals: ["breakfast", "lunch", "dinner", "snacks"] });

  const totals = (await call("get_daily_totals", { start_date: "2026-10-20", end_date: "2026-10-21" })).data;
  expect(totals.days.map((d: any) => [d.date, d.entries, d.kcal])).toEqual([["2026-10-20", 0, 0], ["2026-10-21", 2, 616.8]]);

  const log = (await call("get_food_log", { start_date: "2026-10-21", end_date: "2026-10-21" })).data;
  expect(log.days["2026-10-21"].lunch).toEqual([
    expect.objectContaining({ name: "Laksa", portion: "1 × bowl (604 g)", is_estimate: false, source: "SG FoodID", kcal: 416.8 }),
  ]);
  expect(log.days["2026-10-21"].snacks[0]).toMatchObject({ name: "Bun", is_estimate: true, source: "custom", note: "shared" });
  expect(log.days["2026-10-21"].breakfast).toEqual([]);

  expect((await call("search_foods", { query: "laksa" })).data.results[0]).toMatchObject({ name: "Laksa", source: "SG FoodID", per_100g: { kcal: 69 } });
  expect((await call("list_household_foods")).data).toEqual({ foods: [] });
});

test("bad ranges are refused with a reason", async () => {
  for (const [args, reason] of [
    [{ start_date: "nope", end_date: "2026-10-21" }, "YYYY-MM-DD"],
    [{ start_date: "2026-10-22", end_date: "2026-10-21" }, "before start_date"],
    [{ start_date: "2024-01-01", end_date: "2026-10-21" }, "at most 400 days"],
  ] as const) {
    const out = await call("get_daily_totals", args);
    expect([out.error, out.data]).toEqual([true, expect.stringContaining(reason)]);
  }
});
