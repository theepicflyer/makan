"""Build data/reference/usda.jsonl.gz from USDA FoodData Central CSV releases.

Uses three datasets: Foundation Foods, SR Legacy and FNDDS (survey foods).
Branded foods are left out. Downloads are cached under data/cache/usda/.

    uv run --no-project python -I scripts/fetch_usda.py

FoodData Central data is in the public domain (CC0 1.0).
"""

import csv
import datetime as dt
import gzip
import io
import json
import re
import urllib.request
import zipfile
from pathlib import Path

BASE = "https://fdc.nal.usda.gov/fdc-datasets/"
DATASETS = {
    "foundation": "FoodData_Central_foundation_food_csv_2026-04-30",
    "sr_legacy": "FoodData_Central_sr_legacy_food_csv_2018-04",
    "fndds": "FoodData_Central_survey_food_csv_2024-10-31",
}
DATA_TYPE = {"foundation": "foundation_food", "sr_legacy": "sr_legacy_food", "fndds": "survey_fndds_food"}
USER_AGENT = "makan-snapshot/0.1 (self-hosted nutrition tracker; one-off dataset snapshot)"

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "cache" / "usda"
OUT = ROOT / "data" / "reference" / "usda.jsonl.gz"
MANIFEST = ROOT / "data" / "reference" / "manifest.json"

# Canonical FDC nutrient ids; earlier ids in each tuple win.
NUTRIENTS = {
    "kcal": (1008, 2047, 2048),
    "protein_g": (1003,),
    "carb_g": (1005,),
    "fat_g": (1004,),
    "fibre_g": (1079,),
    "sugar_g": (2000, 1063),
    "sodium_mg": (1093,),
    "sat_fat_g": (1258,),
}
WANTED = {i for ids in NUTRIENTS.values() for i in ids}
ENERGY_BASIS = {1008: "energy", 2047: "atwater_general", 2048: "atwater_specific"}

# Measure units that are yield weights rather than portions someone eats.
SKIP_UNITS = {"paired cooked w", "paired raw w", "dripping w", "orig ckd g", "orig rw g"}
SKIP_PORTION = re.compile(r"^(quantity not specified|guideline amount)", re.I)


def download(name: str) -> Path:
    path = CACHE / f"{name}.zip"
    if not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(BASE + path.name, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=300) as resp:
            path.write_bytes(resp.read())
    return path


def rows(zf: zipfile.ZipFile, folder: str, table: str):
    name = f"{folder}/{table}.csv"
    if name not in zf.namelist():
        return
    with zf.open(name) as raw:
        yield from csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8"))


def fmt_amount(a: str) -> str:
    try:
        v = float(a)
    except ValueError:
        return a.strip()
    return str(int(v)) if v == int(v) else f"{v:g}"


def portion_label(p: dict, units: dict[str, str]) -> str | None:
    desc = (p.get("portion_description") or "").strip()
    modifier = (p.get("modifier") or "").strip()
    unit = units.get(p.get("measure_unit_id") or "", "undetermined")
    if unit in SKIP_UNITS:
        return None
    if desc:
        label = desc
    else:
        amount = fmt_amount(p.get("amount") or "1")
        if unit == "undetermined":
            if not modifier or modifier.isdigit():
                return None
            label = f"{amount} {modifier}"
        else:
            if unit == "RACC":
                unit = "serving (RACC)"
            label = f"{amount} {unit}"
            if modifier and not modifier.isdigit():
                label += f", {modifier}"
    if SKIP_PORTION.match(label):
        return None
    return re.sub(r"\s+", " ", label).strip()


def build(dataset: str) -> tuple[list[dict], dict]:
    folder = DATASETS[dataset]
    zf = zipfile.ZipFile(download(folder))

    nutrient_ids = {}  # what food_nutrient.nutrient_id holds -> canonical id
    for r in rows(zf, folder, "nutrient"):
        nid = int(r["id"])
        nutrient_ids[r["id"]] = nid
        nbr = (r.get("nutrient_nbr") or "").strip()
        if nbr:
            # FNDDS keys food_nutrient by the legacy nutrient number (208 = energy).
            nutrient_ids.setdefault(nbr, nid)
            if nbr.endswith(".0"):
                nutrient_ids.setdefault(nbr[:-2], nid)

    categories = {r["id"]: r["description"] for r in rows(zf, folder, "food_category")}
    categories.update({r["wweia_food_category"]: r["wweia_food_category_description"] for r in rows(zf, folder, "wweia_food_category")})
    units = {r["id"]: r["name"] for r in rows(zf, folder, "measure_unit")}

    foods = {}
    for r in rows(zf, folder, "food"):
        if r["data_type"] == DATA_TYPE[dataset]:
            foods[r["fdc_id"]] = r

    values: dict[str, dict[int, float]] = {}
    for r in rows(zf, folder, "food_nutrient"):
        if r["fdc_id"] not in foods:
            continue
        nid = nutrient_ids.get(r["nutrient_id"])
        if nid in WANTED and r["amount"] not in ("", None):
            values.setdefault(r["fdc_id"], {})[nid] = float(r["amount"])

    portions: dict[str, list[dict]] = {}
    for r in rows(zf, folder, "food_portion"):
        if r["fdc_id"] in foods:
            portions.setdefault(r["fdc_id"], []).append(r)

    records, stats = [], {"foods": len(foods), "no_energy": 0, "energy_fallback": 0}
    for fdc_id, f in foods.items():
        vals = values.get(fdc_id, {})
        per100, basis = {}, None
        for key, ids in NUTRIENTS.items():
            per100[key] = None
            for nid in ids:
                if nid in vals:
                    per100[key] = round(vals[nid], 3)
                    if key == "kcal":
                        basis = ENERGY_BASIS[nid]
                    break
        if per100["kcal"] is None:
            stats["no_energy"] += 1
            continue
        if basis != "energy":
            stats["energy_fallback"] += 1

        servings, seen = [], set()
        for p in sorted(portions.get(fdc_id, []), key=lambda p: (int(p["seq_num"] or 0), int(p["id"]))):
            label = portion_label(p, units)
            try:
                grams = round(float(p["gram_weight"]), 2)
            except (TypeError, ValueError):
                continue
            if not label or grams <= 0 or (label, grams) in seen:
                continue
            seen.add((label, grams))
            servings.append({"label": label, "grams": grams, "default": False})
        if servings:
            servings[0]["default"] = True

        pub = f.get("publication_date") or ""
        records.append({
            "source": "usda",
            "source_ref": fdc_id,
            "name": f["description"].strip(),
            "description": None,
            "category": categories.get(f.get("food_category_id") or ""),
            "per_100g": per100,
            "servings": servings,
            "meta": {"dataset": dataset, "year": int(pub[:4]) if pub[:4].isdigit() else None, "basis": basis},
        })
    stats["records"] = len(records)
    return records, stats


def main():
    all_records, report = [], {}
    for dataset in DATASETS:
        recs, stats = build(dataset)
        report[dataset] = stats
        all_records.extend(recs)
        print(f"{dataset}: {stats}")

    all_records.sort(key=lambda r: (r["meta"]["dataset"], int(r["source_ref"])))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with gzip.GzipFile(OUT, "wb", mtime=0) as gz:
        for rec in all_records:
            gz.write((json.dumps(rec, ensure_ascii=False, sort_keys=True) + "\n").encode())

    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    manifest["usda"] = {
        "file": OUT.name,
        "items": len(all_records),
        "name": "USDA FoodData Central",
        "publisher": "U.S. Department of Agriculture, Agricultural Research Service",
        "accessed": dt.date.today().isoformat(),
        "source_url": "https://fdc.nal.usda.gov/download-datasets",
        "licence": "Public domain (CC0 1.0)",
        "releases": {k: {"file": BASE + v + ".zip", "records": report[k]["records"]} for k, v in DATASETS.items()},
        "attribution": "U.S. Department of Agriculture, Agricultural Research Service. FoodData Central. fdc.nal.usda.gov.",
    }
    MANIFEST.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(f"wrote {len(all_records)} records to {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
