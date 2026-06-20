"""Bulk category update for identical descriptions."""
from datetime import date

from app.crud_finance import create_transaction, similar_transaction_info, update_transaction_category
from app.database import SessionLocal


def _txn(desc, cat="Övrigt", amount=-100):
    return {
        "txn_date": date(2026, 5, 1),
        "amount": amount,
        "description": desc,
        "account": "Test",
        "typ": "Kortköp",
        "category": cat,
    }


def test_similar_transaction_info():
    db = SessionLocal()
    try:
        a = create_transaction(db, _txn("ICA MAXI"))
        create_transaction(db, _txn("ICA MAXI"))
        create_transaction(db, _txn("Annars"))
        info = similar_transaction_info(db, a.id)
        assert info["description"] == "ICA MAXI"
        assert info["total"] == 2
        assert info["others"] == 1
    finally:
        db.close()


def test_update_category_apply_to_similar():
    db = SessionLocal()
    try:
        a = create_transaction(db, _txn("Spotify", "Övrigt"))
        b = create_transaction(db, _txn("Spotify", "Övrigt"))
        create_transaction(db, _txn("Netflix", "Övrigt"))
        _, count = update_transaction_category(db, a.id, "Streaming", apply_to_similar=True)
        assert count == 2
        db.expire_all()
        assert db.get(type(a), a.id).category == "Streaming"
        assert db.get(type(b), b.id).category == "Streaming"
    finally:
        db.close()
