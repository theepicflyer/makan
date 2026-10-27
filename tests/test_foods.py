import pytest

from makan import foods as food_svc
from tests.conftest import food_id


def test_search_finds_hawker_dish(db):
    hits = food_svc.search(db, "laksa")
    assert hits[0].food.name == "Laksa"


def test_search_prefix_and_multiword(db):
    assert food_svc.search(db, "kopi")[0].food.name == "Kopi C"
    assert food_svc.search(db, "greek yogurt")[0].food.source == "usda"


def test_search_plural_finds_singular(db):
    assert food_svc.search(db, "eggs")[0].food.name == "Egg, whole, raw, fresh"
    assert food_svc.search(db, "kaya toasts")[0].food.name == "Kaya toast"


def test_household_alias_wins(db, alice):
    food, _ = food_svc.save_ours(
        db,
        user_id=alice.id,
        name="Chobani Greek Light",
        brand="Chobani",
        nutrients={"kcal": 55, "protein_g": 9.4, "carb_g": 4.1, "fat_g": 0},
        servings=[{"label": "tub", "grams": 150}, {"label": "bowl", "grams": 170}],
        aliases=["Yogurt", "greek yogurt"],
    )
    assert food.aliases == ["yogurt", "greek yogurt"]
    assert food.servings[0]["default"] is True
    assert food_svc.search(db, "yogurt")[0].food.id == food.id
    assert food_svc.search(db, "greek yogurt")[0].food.id == food.id


def test_alias_moves_between_household_foods(db, alice):
    a, _ = food_svc.save_ours(
        db, user_id=alice.id, name="Yogurt A", nutrients={"kcal": 60}, aliases=["yogurt"]
    )
    b, _ = food_svc.save_ours(
        db, user_id=alice.id, name="Yogurt B", nutrients={"kcal": 70}, aliases=["yogurt"]
    )
    assert a.aliases == [] and b.aliases == ["yogurt"]


def test_reference_foods_are_read_only(db, alice):
    with pytest.raises(food_svc.FoodError):
        food_svc.save_ours(db, user_id=alice.id, food_id=food_id(db, "Laksa"), name="Edited")


def test_resolve_portion(db):
    laksa = food_svc.get_food(db, food_id(db, "Laksa"))
    assert food_svc.resolve_portion(laksa).grams == 604
    assert food_svc.resolve_portion(laksa, servings=0.5, serving="1 bowl(s)").grams == 302
    assert food_svc.resolve_portion(laksa, grams=250).grams == 250
    assert food_svc.resolve_portion(laksa, servings=2, serving="100 g").grams == 200
    with pytest.raises(food_svc.FoodError):
        food_svc.resolve_portion(laksa, serving="plate")
    assert food_svc.scale(laksa, 604)["kcal"] == pytest.approx(416.76)
