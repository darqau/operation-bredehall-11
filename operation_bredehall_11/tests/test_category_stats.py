"""Category stats respects exclude_overforing."""
from datetime import date

from app.crud_finance import category_stats, create_transaction
from app.database import SessionLocal
from app.models import FinanceTransaction


def test_category_stats_excludes_overforing():
    db = SessionLocal()
    try:
        d = date(2026, 4, 15)
        create_transaction(db, {
            "txn_date": d,
            "amount": -500.0,
            "description": "Hyra",
            "account": "Test",
            "typ": "Överföring",
            "category": "Överföring",
        })
        create_transaction(db, {
            "txn_date": d,
            "amount": -200.0,
            "description": "ICA",
            "account": "Test",
            "typ": "Utgift",
            "category": "Livsmedel",
        })
        all_stats = category_stats(db, year=2026, month=4, expenses_only=True, exclude_overforing=False)
        hidden = category_stats(db, year=2026, month=4, expenses_only=True, exclude_overforing=True)
        all_cats = {s["category"] for s in all_stats}
        hidden_cats = {s["category"] for s in hidden}
        assert "Överföring" in all_cats
        assert "Överföring" not in hidden_cats
        assert "Livsmedel" in hidden_cats
    finally:
        db.query(FinanceTransaction).filter(FinanceTransaction.account == "Test").delete()
        db.commit()
        db.close()
