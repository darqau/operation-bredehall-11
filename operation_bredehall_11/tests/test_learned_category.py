"""Learned category mappings from user corrections."""
from datetime import date

from app.crud_finance import (
    apply_learned_category,
    create_transaction,
    get_learned_categories,
    update_transaction_category,
)
from app.database import SessionLocal
from app.services.finance.categorizer import enrich_transaction


def _txn(desc, cat="Övrigt", amount=-100):
    return {
        "txn_date": date(2026, 6, 1),
        "amount": amount,
        "description": desc,
        "account": "Test",
        "typ": "Utgift",
        "category": cat,
    }


def test_learned_category_from_locked_row():
    db = SessionLocal()
    try:
        t = create_transaction(db, _txn("Unik Butik XYZ"))
        update_transaction_category(db, t.id, "Shopping & Kläder", apply_to_similar=False)
        learned = get_learned_categories(db)
        assert learned["Unik Butik XYZ"] == "Shopping & Kläder"
    finally:
        db.close()


def test_apply_learned_on_enrich():
    row = {"amount": -50, "description": "Unik Butik XYZ", "sender": None, "receiver": None}
    apply_learned_category(row, {"Unik Butik XYZ": "Shopping & Kläder"})
    enriched = enrich_transaction(row, "")
    assert enriched["category"] == "Shopping & Kläder"


def test_latest_locked_wins():
    db = SessionLocal()
    try:
        a = create_transaction(db, _txn("Vendor AB"))
        update_transaction_category(db, a.id, "Livsmedel", apply_to_similar=False)
        b = create_transaction(db, _txn("Vendor AB"))
        update_transaction_category(db, b.id, "Restaurang & Uteät", apply_to_similar=False)
        learned = get_learned_categories(db)
        assert learned["Vendor AB"] == "Restaurang & Uteät"
    finally:
        db.close()
