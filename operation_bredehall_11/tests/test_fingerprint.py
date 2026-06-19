from datetime import date

from app.crud_finance import amount_to_ore, create_transactions_bulk, escape_like, transaction_fingerprint
from app.database import SessionLocal
from app.models import FinanceTransaction


def test_escape_like():
    assert escape_like("100%") == "100\\%"
    assert escape_like("a_b") == "a\\_b"


def test_fingerprint_uses_ore():
    fp = transaction_fingerprint("Konto", date(2025, 1, 1), 123.45, "Test", amount_ore=12345)
    assert fp[2] == 12345


def test_bulk_dedup():
    db = SessionLocal()
    rows = [
        {
            "txn_date": date(2025, 6, 1),
            "amount": -100.0,
            "description": "ICA",
            "account": "Test",
            "typ": "Utgift",
            "category": "Livsmedel",
        },
        {
            "txn_date": date(2025, 6, 1),
            "amount": -100.0,
            "description": "ICA",
            "account": "Test",
            "typ": "Utgift",
            "category": "Livsmedel",
        },
    ]
    result = create_transactions_bulk(db, rows)
    assert result["added"] == 1
    assert result["skipped"] == 1
    db.close()


def test_amount_to_ore():
    assert amount_to_ore(123.45) == 12345
