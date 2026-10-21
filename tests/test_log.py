from datetime import date

import pytest

from makan import log as log_svc
from makan.models import Thread, Turn
from tests.conftest import food_id

DAY = date(2026, 1, 15)


def test_add_update_delete(db, alice):
    toast = food_id(db, "Kaya toast")
    e = log_svc.add_entry(
        db, alice, day=DAY, meal="breakfast", food_id=toast, servings=2, serving="slice"
    )
    assert e.grams == 90 and e.kcal == pytest.approx(297)
    # "make that 3" keeps the slice serving
    e = log_svc.update_entry(db, alice, e.id, servings=3)
    assert e.serving_label == "slice" and e.grams == 135
    e = log_svc.update_entry(db, alice, e.id, meal="snacks")
    assert e.meal == "snacks"
    log_svc.delete_entry(db, alice, e.id)
    assert log_svc.entries_between(db, alice, DAY, DAY) == []


def test_custom_entry_scales_with_servings(db, alice):
    e = log_svc.add_entry(
        db,
        alice,
        day=DAY,
        meal="dinner",
        name="Mee rebus (est.)",
        servings=1,
        nutrients={"kcal": 550, "protein_g": 20, "carb_g": 70, "fat_g": 18},
    )
    assert e.is_estimate
    e = log_svc.update_entry(db, alice, e.id, servings=0.5)
    assert e.kcal == 275 and e.protein_g == 10


def test_supper_goes_to_snacks(db, alice):
    e = log_svc.add_entry(db, alice, day=DAY, meal="supper", food_id=food_id(db, "Kopi C"))
    assert e.meal == "snacks"


def test_undo_reverts_a_turn(db, alice):
    thread = Thread(user_id=alice.id, date=DAY, model="x")
    db.add(thread)
    db.flush()
    turn = Turn(thread_id=thread.id)
    db.add(turn)
    db.flush()
    keep = log_svc.add_entry(db, alice, day=DAY, meal="lunch", food_id=food_id(db, "Laksa"))
    changes = log_svc.ChangeLog(db, turn.id)
    added = log_svc.add_entry(
        db, alice, day=DAY, meal="breakfast", food_id=food_id(db, "Kopi C"), changes=changes
    )
    log_svc.update_entry(db, alice, keep.id, servings=0.5, changes=changes)
    log_svc.delete_entry(db, alice, keep.id, changes=changes)
    assert [e.id for e in log_svc.entries_between(db, alice, DAY, DAY)] == [added.id]
    log_svc.undo_changes(db, turn.id)
    entries = log_svc.entries_between(db, alice, DAY, DAY)
    assert [e.id for e in entries] == [keep.id]
    assert entries[0].grams == 604


def test_quick_items(db, alice):
    kopi = food_id(db, "Kopi C")
    for _ in range(3):
        log_svc.add_entry(db, alice, day=DAY, meal="breakfast", food_id=kopi)
    q = log_svc.quick_items(db, alice, meal="breakfast", day=DAY)
    assert q["frequent"][0]["food_id"] == kopi
    assert q["recent"][0]["food_id"] == kopi
