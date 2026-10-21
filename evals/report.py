"""Summarise every run under evals/results/ into evals/results/summary.md.

uv run python -m evals.report
"""

import json
import math
import statistics
from collections import defaultdict
from pathlib import Path

RESULTS = Path(__file__).parent / "results"


def _load(run: Path) -> tuple[list[dict], list[dict]]:
    rows = (
        [json.loads(line) for line in (run / "results.jsonl").read_text().splitlines()]
        if (run / "results.jsonl").exists()
        else []
    )
    errors = (
        [json.loads(line) for line in (run / "errors.jsonl").read_text().splitlines()]
        if (run / "errors.jsonl").exists()
        else []
    )
    return rows, errors


def _ci(p: float, n: int) -> float:
    return 1.96 * math.sqrt(p * (1 - p) / n) if n else 0.0


def summarise() -> str:
    runs = sorted(
        p
        for p in RESULTS.iterdir()
        if p.is_dir() and (p / "results.jsonl").exists() and p.name != "pilot"
    )
    lines = [
        "# makan agent eval",
        "",
        (
            "Pass = every check on the case passed (right foods, meals, dates and portions; household foods used or "
            "left alone as asked). Photo kcal error is |logged day total − Claude's reference estimate| / reference. "
            "Cost and latency are per case, all turns included."
        ),
        "",
        "| run | cases×reps | pass | text pass | photo pass | photo kcal err (median) | $/case | $/1000 cases | latency p50 | cache read share | errors |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    per_case: dict[str, dict[str, list[float]]] = defaultdict(dict)
    for run in runs:
        rows, errors = _load(run)
        if not rows:
            continue
        n = len(rows)
        passed = statistics.mean(r["grade"]["pass"] for r in rows)
        text = [r["grade"]["pass"] for r in rows if "text" in r["tags"]]
        photo = [r["grade"]["pass"] for r in rows if "photo" in r["tags"]]
        kerr = [r["grade"]["kcal_err"] for r in rows if "kcal_err" in r["grade"]]
        cost = statistics.mean(r["cost_usd"] for r in rows)
        lat = statistics.median(r["latency_s"] for r in rows)
        u = defaultdict(int)
        for r in rows:
            for k, v in r["usage"].items():
                u[k] += v
        prompt = u["input_tokens"] + u["cache_read_input_tokens"] + u["cache_creation_input_tokens"]
        share = u["cache_read_input_tokens"] / prompt if prompt else 0
        cases = len({r["prompt_id"] for r in rows})
        reps = max(r["rep"] for r in rows) + 1
        lines.append(
            f"| {run.name} | {cases}×{reps} | {passed:.0%} ± {_ci(passed, n):.0%} | "
            f"{statistics.mean(text):.0%} | {f'{statistics.mean(photo):.0%}' if photo else '—'} | "
            f"{f'{statistics.median(kerr):.0%}' if kerr else '—'} | ${cost:.4f} | ${cost * 1000:.2f} | {lat:.1f}s | {share:.0%} | {len(errors)} |"
        )
        for r in rows:
            per_case[r["prompt_id"]].setdefault(run.name, []).append(r["grade"]["pass"])

    names = [r.name for r in runs]
    lines += [
        "",
        "## Per case (passes / reps)",
        "",
        "| case | " + " | ".join(names) + " |",
        "|---|" + "---|" * len(names),
    ]
    for case_id in sorted(per_case):
        cells = []
        for name in names:
            v = per_case[case_id].get(name)
            cells.append("" if v is None else f"{int(sum(v))}/{len(v)}")
        lines.append(f"| {case_id} | " + " | ".join(cells) + " |")

    lines += ["", "## Failures", ""]
    for run in runs:
        rows, errors = _load(run)
        bad = [r for r in rows if not r["grade"]["pass"]]
        if not bad and not errors:
            continue
        lines.append(f"### {run.name}")
        for r in bad:
            lines.append(f"- `{r['prompt_id']}#{r['rep']}`: {'; '.join(r['failures'])[:400]}")
        for e in errors:
            lines.append(
                f"- `{e['prompt_id']}#{e['rep']}` ERROR {e['class']}: {e['message'][:200]}"
            )
        lines.append("")
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    out = RESULTS / "summary.md"
    out.write_text(summarise())
    print(out.read_text())
