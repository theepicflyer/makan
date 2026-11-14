/**
 * Summarise every run under evals/results/ into evals/results/summary.md.
 *
 *   npm run evals:report
 */
import fs from "node:fs";
import path from "node:path";
import { RESULTS } from "./run.js";

type Row = Record<string, any>;

function load(run: string): { rows: Row[]; errors: Row[] } {
  const read = (name: string): Row[] => {
    const file = path.join(run, name);
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  };
  return { rows: read("results.jsonl"), errors: read("errors.jsonl") };
}

const mean = (values: number[]) => values.reduce((s, v) => s + v, 0) / values.length;
const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};
const pct = (value: number) => `${(value * 100).toFixed(0)}%`;
const ci = (p: number, n: number) => (n ? 1.96 * Math.sqrt((p * (1 - p)) / n) : 0);

function quantile(values: number[], q: number): string {
  if (!values.length) return "—";
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!.toFixed(1);
}

function timingRow(name: string, rows: Row[]): string {
  const [firstChanged, firstDone, editChanged, editDone, photoDone]: number[][] = [[], [], [], [], []];
  for (const r of rows) {
    for (const t of r.turns ?? []) {
      if (t.turn === 0) {
        if (r.tags.includes("photo")) photoDone!.push(t.done_s);
        else {
          firstDone!.push(t.done_s);
          if ("changed_s" in t) firstChanged!.push(t.changed_s);
        }
      } else if (r.tags.includes("add_then_edit")) {
        editDone!.push(t.done_s);
        if ("changed_s" in t) editChanged!.push(t.changed_s);
      }
    }
  }
  return (
    `| ${name} | ${quantile(firstChanged!, 0.5)} | ${quantile(firstDone!, 0.5)} / ${quantile(firstDone!, 0.9)} | ` +
    `${quantile(editChanged!, 0.5)} | ${quantile(editDone!, 0.5)} / ${quantile(editDone!, 0.9)} | ${quantile(photoDone!, 0.5)} |`
  );
}

export function summarise(): string {
  const runs = fs
    .readdirSync(RESULTS)
    .filter((n) => n !== "pilot" && fs.existsSync(path.join(RESULTS, n, "results.jsonl")))
    .sort();
  const lines = [
    "# Bao agent eval",
    "",
    "Pass = every check on the case passed (right foods, meals, dates and portions; household foods used or " +
      "left alone as asked). Photo kcal error is |logged day total − Claude's reference estimate| / reference. " +
      "Cost and latency are per case, all turns included.",
    "",
    "| run | cases×reps | pass | text pass | photo pass | edit-after-add pass | photo kcal err (median) | $/case | cache read share | errors |",
    "|---|---|---|---|---|---|---|---|---|---|",
  ];
  const timing = [
    "",
    "## Wall time per message",
    "",
    "Seconds from sending a message to: the log changing on screen (`changed`), and the reply finishing " +
      "(`done`). First messages usually search then log; follow-up edits usually skip the search.",
    "",
    "| run | first message: changed p50 | first message: done p50 / p90 | follow-up edit: changed p50 | follow-up edit: done p50 / p90 | photo message: done p50 |",
    "|---|---|---|---|---|---|",
  ];
  const perCase = new Map<string, Map<string, number[]>>();
  const loaded = runs.map((name) => ({ name, ...load(path.join(RESULTS, name)) })).filter((r) => r.rows.length);
  for (const { name, rows, errors } of loaded) {
    const passes = (tag?: string) => rows.filter((r) => !tag || r.tags.includes(tag)).map((r) => r.grade.pass as number);
    const share = (tag: string) => (passes(tag).length ? pct(mean(passes(tag))) : "—");
    const passed = mean(passes());
    const kcalErr = rows.filter((r) => "kcal_err" in r.grade).map((r) => r.grade.kcal_err as number);
    const u: Record<string, number> = {};
    for (const r of rows) for (const [k, v] of Object.entries(r.usage)) u[k] = (u[k] ?? 0) + (v as number);
    const prompt = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    const cases = new Set(rows.map((r) => r.prompt_id)).size;
    const reps = Math.max(...rows.map((r) => r.rep)) + 1;
    lines.push(
      `| ${name} | ${cases}×${reps} | ${pct(passed)} ± ${pct(ci(passed, rows.length))} | ${pct(mean(passes("text")))} | ` +
        `${share("photo")} | ${share("add_then_edit")} | ${kcalErr.length ? pct(median(kcalErr)) : "—"} | ` +
        `$${mean(rows.map((r) => r.cost_usd)).toFixed(4)} | ${pct(prompt ? (u.cache_read_input_tokens ?? 0) / prompt : 0)} | ${errors.length} |`,
    );
    timing.push(timingRow(name, rows));
    for (const r of rows) {
      const byRun = perCase.get(r.prompt_id) ?? new Map<string, number[]>();
      byRun.set(name, [...(byRun.get(name) ?? []), r.grade.pass]);
      perCase.set(r.prompt_id, byRun);
    }
  }
  lines.push(...timing);
  const names = loaded.map((r) => r.name);
  lines.push("", "## Per case (passes / reps)", "", `| case | ${names.join(" | ")} |`, `|---|${"---|".repeat(names.length)}`);
  for (const id of [...perCase.keys()].sort()) {
    const cells = names.map((n) => {
      const v = perCase.get(id)!.get(n);
      return v ? `${v.reduce((s, x) => s + x, 0)}/${v.length}` : "";
    });
    lines.push(`| ${id} | ${cells.join(" | ")} |`);
  }
  lines.push("", "## Failures", "");
  for (const { name, rows, errors } of loaded) {
    const bad = rows.filter((r) => !r.grade.pass);
    if (!bad.length && !errors.length) continue;
    lines.push(`### ${name}`);
    for (const r of bad) lines.push(`- \`${r.prompt_id}#${r.rep}\`: ${r.failures.join("; ").slice(0, 400)}`);
    for (const e of errors) lines.push(`- \`${e.prompt_id}#${e.rep}\` ERROR ${e.class}: ${e.message.slice(0, 200)}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const out = path.join(RESULTS, "summary.md");
  fs.writeFileSync(out, summarise());
  console.log(fs.readFileSync(out, "utf8"));
}
