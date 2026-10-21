"""Snapshot HPB's SG FoodID database into data/reference/sgfoodid.jsonl.gz.

The public food-search page is backed by an unauthenticated JSON API. Listing
needs a filter (an empty search returns nothing), so every item is reached by
paging each food group. Detail records are cached per item under
data/cache/sgfoodid/, so an interrupted run resumes where it stopped.

    uv run --no-project python -I scripts/fetch_sgfoodid.py [--verify] [--refresh]

--verify   also pages full-text searches and checks every hit is in the snapshot
--refresh  re-download list pages and details instead of using the cache

Licence: SG FoodID data terms allow use, copying, modification and
redistribution with a conspicuous attribution notice. See data/reference/manifest.json.
"""

import argparse
import datetime as dt
import gzip
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://pphtpc.hpb.gov.sg/bff/v1/food-portal"
SITE = "https://pphtpc.hpb.gov.sg/web/sgfoodid"
USER_AGENT = "makan-snapshot/0.1 (self-hosted nutrition tracker; one-off dataset snapshot)"
MIN_INTERVAL = 1.05  # the API allows 60 requests a minute (x-ratelimit-limit)
PAGE_SIZE = 25
COMPARE_BATCH = 10  # foods/compare returns full detail records for 2-10 ids

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "cache" / "sgfoodid"
OUT = ROOT / "data" / "reference" / "sgfoodid.jsonl.gz"
MANIFEST = ROOT / "data" / "reference" / "manifest.json"

NUTRIENTS = {
    "kcal": "energy",
    "protein_g": "protein",
    "carb_g": "carbohydrate",
    "fat_g": "fat",
    "fibre_g": "dietaryFibre",
    "sugar_g": "sugar",
    "sodium_mg": "sodium",
    "sat_fat_g": "saturatedFat",
}

_last_request = 0.0


def get_json(path: str, params: dict | list | None = None):
    global _last_request
    url = f"{API}/{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    for attempt in range(6):
        wait = _last_request + MIN_INTERVAL - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        _last_request = time.monotonic()
        backoff = 2 ** attempt
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.load(resp)
                if resp.headers.get("x-ratelimit-remaining") == "0":
                    time.sleep(int(resp.headers.get("x-ratelimit-reset") or 60) + 1)
                return data
        except urllib.error.HTTPError as e:
            if e.code != 429 and 400 <= e.code < 500:
                raise
            if e.code == 429:
                backoff = int(e.headers.get("x-ratelimit-reset") or 60) + 1
            err = e
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            err = e
        print(f"  retry {attempt + 1} for {url} in {backoff}s ({err})", file=sys.stderr)
        time.sleep(backoff)
    raise RuntimeError(f"giving up on {url}")


def page_all(params: dict) -> list[dict]:
    rows, page, total = [], 1, None
    while True:
        batch = get_json("foods", {**params, "pageNumber": page})
        if not isinstance(batch, list):
            raise ValueError(f"{params}: unexpected response {str(batch)[:200]}")
        if not batch:
            break
        total = batch[0]["totalCount"]
        rows.extend(batch)
        if len(rows) >= total or len(batch) < PAGE_SIZE:
            break
        page += 1
    if total is not None and len(rows) != total:
        raise RuntimeError(f"{params}: got {len(rows)} rows, API reports {total}")
    return rows


def list_items(refresh: bool) -> tuple[list[dict], dict]:
    cached = CACHE / "list.json"
    if cached.exists() and not refresh:
        data = json.loads(cached.read_text())
        return data["items"], data["counts"]

    groups = get_json("foods/groups")
    items: dict[str, dict] = {}
    counts = {"groups": {}}
    for g in sorted(groups, key=lambda g: g["id"]):
        rows = page_all({"foodGroupId": g["id"]})
        counts["groups"][f'{g["id"]} {g["name"]}'] = len(rows)
        print(f"group {g['id']:>2} {g['name']}: {len(rows)}", flush=True)
        for r in rows:
            items.setdefault(r["crId"], r)

    # Cross-check the per-group union against the type filters the UI uses.
    for kind in ("Drink", "Food"):
        try:
            counts[f"type={kind}"] = len(page_all({"type": kind}))
        except (urllib.error.HTTPError, ValueError) as e:
            counts[f"type={kind}"] = f"error: {e}"[:120]
    counts["union"] = len(items)

    CACHE.mkdir(parents=True, exist_ok=True)
    out = {"items": sorted(items.values(), key=lambda r: r["crId"]), "counts": counts}
    cached.write_text(json.dumps(out, indent=1))
    return out["items"], counts


def fetch_details(items: list[dict], refresh: bool) -> dict[str, dict]:
    ddir = CACHE / "details"
    ddir.mkdir(parents=True, exist_ok=True)
    details, todo = {}, []
    for row in items:
        path = ddir / f"{row['crId']}.json"
        if path.exists() and not refresh:
            details[row["crId"]] = json.loads(path.read_text())
        else:
            todo.append(row["crId"])

    def keep(d):
        (ddir / f"{d['crId']}.json").write_text(json.dumps(d))
        details[d["crId"]] = d

    for start in range(0, len(todo), COMPARE_BATCH):
        batch = todo[start:start + COMPARE_BATCH]
        if len(batch) < 2:
            keep(get_json(f"foods/details/{batch[0]}"))
            continue
        for d in get_json("foods/compare", [("crIds", c) for c in batch]):
            keep(d)
        for c in batch:
            if c not in details:  # compare silently dropped it; ask for it alone
                keep(get_json(f"foods/details/{c}"))
        print(f"details {min(start + COMPARE_BATCH, len(todo))}/{len(todo)}", flush=True)
    return details


def verify(items: list[dict]) -> dict:
    known = {r["crId"] for r in items}
    report = {}
    for term in ("a", "e", "o", "1"):
        rows = page_all({"searchText": term})
        missing = sorted({r["crId"] for r in rows} - known)
        report[term] = {"hits": len(rows), "missing": missing}
        print(f"verify '{term}': {len(rows)} hits, {len(missing)} not in snapshot", flush=True)
    return report


def num(v):
    if v is None or v == -1:
        return None
    return v


PORTION_RE = re.compile(r"^\s*(?P<label>.+?)\s*=\s*(?P<qty>\d+(?:\.\d+)?)\s*(?P<unit>g|ml)\s*$", re.I)


def parse_portion(text: str | None) -> tuple[str, float] | None:
    if not text or text.strip() in ("", "-"):
        return None
    m = PORTION_RE.match(text)
    if not m:
        return None
    label = m["label"]
    amount = re.match(r"^\s*(\d+(?:[./]\d+)?)", label)
    plural = not amount or amount[1] not in ("1", "1.0")
    label = label.replace("(s)", "s" if plural else "")
    return re.sub(r"\s+", " ", label).strip(), float(m["qty"])


def split_portions(text: str | None) -> list[str]:
    if not text or text.strip() in ("", "-"):
        return []
    # Several alternatives are separated by commas, semicolons or newlines,
    # but a label may contain a comma itself, so split only before "<n> ".
    return [p for p in re.split(r"\s*[,;\n]\s*(?=\d)", text) if p.strip()]


def to_record(d: dict, unparsed: list) -> dict | None:
    base = d.get("baseFoodNutrients") or {}
    per100 = {k: num(base.get(src)) for k, src in NUTRIENTS.items()}
    if per100["kcal"] is None:
        return None

    # Nutrients are per 100 g of the edible part, while portion weights include
    # shell, bone or peel, so serving grams are scaled down to the edible part.
    edible = (d.get("ediblePortion") or 100) / 100

    def serving(label, weight, default):
        return {"label": label, "grams": round(weight * edible, 1), "default": default}

    servings = []
    default = parse_portion(d.get("defaultPortion"))
    if default:
        servings.append(serving(*default, True))
    elif d.get("defaultWeight"):
        servings.append(serving("1 serving", float(d["defaultWeight"]), True))
        if d.get("defaultPortion") not in (None, "", "-"):
            unparsed.append((d["crId"], d.get("defaultPortion")))
    for alt in split_portions(d.get("alternativePortions")):
        p = parse_portion(alt)
        if p is None:
            unparsed.append((d["crId"], alt))
            continue
        s = serving(*p, False)
        if not any(x["label"] == s["label"] and x["grams"] == s["grams"] for x in servings):
            servings.append(s)

    desc = (d.get("description") or "").strip()
    l1, l2 = d.get("l1Category"), d.get("l2Category")
    return {
        "source": "sgfoodid",
        "source_ref": d["crId"],
        "name": d["name"].strip(),
        "description": desc if desc and desc != "-" else None,
        "category": " / ".join(c for c in (l1, l2) if c) or None,
        "per_100g": per100,
        "servings": servings,
        "meta": {"dataset": "sgfoodid", "year": d.get("yearOfData"), "basis": d.get("sourceOfData")},
    }


def check_per_100g(details: dict[str, dict]) -> dict:
    """baseFoodNutrients × edible grams of the default portion / 100 should equal calculatedFoodNutrients."""
    checked = mismatched = 0
    examples = []
    for d in details.values():
        w = d.get("defaultWeight")
        b, c = (d.get("baseFoodNutrients") or {}).get("energy"), (d.get("calculatedFoodNutrients") or {}).get("energy")
        if not w or b in (None, -1) or c in (None, -1):
            continue
        checked += 1
        edible = (d.get("ediblePortion") or 100) / 100
        if abs(b * w * edible / 100 - c) > max(1.5, 0.02 * c):
            mismatched += 1
            if len(examples) < 5:
                examples.append({"crId": d["crId"], "base": b, "calc": c, "weight": w, "edible": d.get("ediblePortion")})
    return {"checked": checked, "mismatched": mismatched, "examples": examples}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--verify", action="store_true")
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args()

    items, counts = list_items(args.refresh)
    print(f"listed {len(items)} unique items; counts: {json.dumps(counts)}")
    deactivated = [r["crId"] for r in items if r.get("isDeactivated")]
    details = fetch_details([r for r in items if not r.get("isDeactivated")], args.refresh)

    unparsed: list = []
    records, no_energy = [], []
    for crid in sorted(details):
        rec = to_record(details[crid], unparsed)
        if rec is None:
            no_energy.append(crid)
        else:
            records.append(rec)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with gzip.GzipFile(OUT, "wb", mtime=0) as gz:
        for rec in records:
            gz.write((json.dumps(rec, ensure_ascii=False, sort_keys=True) + "\n").encode())

    basis = check_per_100g(details)
    report = {
        "items": len(records),
        "listed": len(items),
        "deactivated_skipped": deactivated,
        "no_energy_dropped": no_energy,
        "unparsed_portions": unparsed,
        "per_100g_check": basis,
        "list_counts": counts,
    }
    previous = CACHE / "report.json"
    if args.verify:
        report["verify"] = verify(items)
    elif previous.exists():
        report["verify"] = json.loads(previous.read_text()).get("verify")
    (CACHE / "report.json").write_text(json.dumps(report, indent=1))

    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    manifest["sgfoodid"] = {
        "file": OUT.name,
        "items": len(records),
        "name": "Singapore Food Insights Database (SG FoodID)",
        "publisher": "Health Promotion Board, Singapore",
        "accessed": dt.date.today().isoformat(),
        "source_url": SITE,
        "api_url": API,
        "licence_url": "https://file.go.gov.sg/termsofuse-hpbsgfoodid.pdf",
        "attribution": (
            "Contains information from Singapore Food Insights Database (SG FoodID) accessed on "
            f"{dt.date.today().isoformat()} from Health Promotion Board which is made available under "
            f"the terms found at {SITE}. The information contained within this dataset is provided on an "
            '"as-is" basis. The data, including but not limited to nutritional information, is subject to '
            "inherent limitations. No warranty or representation is made as to the accuracy or "
            "completeness of the data contained herein."
        ),
    }
    MANIFEST.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")

    print(f"wrote {len(records)} records to {OUT} ({OUT.stat().st_size} bytes)")
    print(f"dropped (no energy): {len(no_energy)}; deactivated skipped: {len(deactivated)}; unparsed portions: {len(unparsed)}")
    print(f"per-100g check: {basis}")


if __name__ == "__main__":
    main()
