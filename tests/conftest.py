import gzip
import json
import os
import tempfile
from pathlib import Path

_TMP = Path(tempfile.mkdtemp(prefix="makan-test-"))
_REF = _TMP / "reference"
_REF.mkdir()
os.environ.update(
    {
        "DATA_DIR": str(_TMP / "data"),
        "REFERENCE_DIR": str(_REF),
        "STATIC_DIR": str(_TMP / "static"),
        "DEV_LOGIN": "true",
        "MCP_DEV_USER": "Tester",
        "OIDC_CONFIG_URL": "",
        "PUBLIC_URL": "http://testserver",
        # tests drive reminders.tick() themselves
        "REMINDERS": "false",
    }
)

REFERENCE = [
    {
        "source": "sgfoodid",
        "source_ref": "F05060073",
        "name": "Laksa",
        "description": "Rice vermicelli in coconut gravy",
        "category": "Grains and staples / Noodle/Pasta-based dishes",
        "per_100g": {
            "kcal": 69,
            "protein_g": 3.31,
            "carb_g": 6.94,
            "fat_g": 2.95,
            "fibre_g": 0.91,
            "sugar_g": 0.1,
            "sodium_mg": 511,
            "sat_fat_g": 1.43,
        },
        "servings": [{"label": "bowl", "grams": 604, "default": True}],
        "meta": {},
    },
    {
        "source": "sgfoodid",
        "source_ref": "F09000001",
        "name": "Kopi C",
        "description": None,
        "category": "Beverages",
        "per_100g": {
            "kcal": 43,
            "protein_g": 1.2,
            "carb_g": 7.0,
            "fat_g": 1.1,
            "fibre_g": None,
            "sugar_g": 7.0,
            "sodium_mg": 20,
            "sat_fat_g": 0.7,
        },
        "servings": [{"label": "cup", "grams": 250, "default": True}],
        "meta": {},
    },
    {
        "source": "sgfoodid",
        "source_ref": "F05010001",
        "name": "Kaya toast",
        "description": None,
        "category": "Grains",
        "per_100g": {
            "kcal": 330,
            "protein_g": 6,
            "carb_g": 45,
            "fat_g": 14,
            "fibre_g": 1,
            "sugar_g": 15,
            "sodium_mg": 400,
            "sat_fat_g": 8,
        },
        "servings": [
            {"label": "slice", "grams": 45, "default": True},
            {"label": "set", "grams": 135, "default": False},
        ],
        "meta": {},
    },
    {
        "source": "usda",
        "source_ref": "170903",
        "name": "Yogurt, Greek, plain, nonfat",
        "description": None,
        "category": "Dairy",
        "per_100g": {
            "kcal": 59,
            "protein_g": 10.2,
            "carb_g": 3.6,
            "fat_g": 0.4,
            "fibre_g": 0,
            "sugar_g": 3.2,
            "sodium_mg": 36,
            "sat_fat_g": 0.1,
        },
        "servings": [{"label": "container", "grams": 170, "default": True}],
        "meta": {},
    },
    {
        "source": "usda",
        "source_ref": "171287",
        "name": "Egg, whole, raw, fresh",
        "description": None,
        "category": "Eggs",
        "per_100g": {
            "kcal": 143,
            "protein_g": 12.6,
            "carb_g": 0.7,
            "fat_g": 9.5,
            "fibre_g": 0,
            "sugar_g": 0.4,
            "sodium_mg": 142,
            "sat_fat_g": 3.1,
        },
        "servings": [{"label": "large", "grams": 50, "default": True}],
        "meta": {},
    },
]
with gzip.open(_REF / "fixture.jsonl.gz", "wt") as fh:
    for rec in REFERENCE:
        fh.write(json.dumps(rec) + "\n")

import pytest
from fastapi.testclient import TestClient

from makan.db import new_session
from makan.main import app
from makan.models import Food, User


@pytest.fixture(scope="session")
def client():
    with TestClient(app, headers={"x-makan": "1"}) as c:
        yield c


@pytest.fixture
def logged_in(client):
    client.post("/api/auth/dev-login", json={"name": "Alice"})
    yield client
    client.post("/api/auth/logout")


@pytest.fixture
def db(client):
    session = new_session()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture
def alice(db) -> User:
    from makan.auth import upsert_user

    return upsert_user(db, sub="dev:alice", email="alice@dev.local", name="Alice")


def food_id(db, name: str) -> int:
    from sqlalchemy import select

    return db.scalar(select(Food.id).where(Food.name == name))
