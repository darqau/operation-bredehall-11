"""Account compare API — monthly expenses for two accounts."""
from datetime import date

from app.crud_finance import create_transaction
from app.database import SessionLocal, init_db
from app.services.finance.dashboard import build_account_compare


def test_account_compare_monthly_totals():
    init_db()
    db = SessionLocal()
    try:
        create_transaction(db, {
            "txn_date": date(2026, 1, 5),
            "description": "ICA",
            "amount": -100.0,
            "account": "Konto A",
            "category": "Livsmedel",
            "typ": "Kortköp",
        })
        create_transaction(db, {
            "txn_date": date(2026, 1, 8),
            "description": "LIDL",
            "amount": -50.0,
            "account": "Konto B",
            "category": "Livsmedel",
            "typ": "Kortköp",
        })
        create_transaction(db, {
            "txn_date": date(2026, 2, 1),
            "description": "Coop",
            "amount": -200.0,
            "account": "Konto A",
            "category": "Livsmedel",
            "typ": "Kortköp",
        })
        result = build_account_compare(
            db,
            account_a="Konto A",
            account_b="Konto B",
            categories=["Livsmedel"],
            months=12,
        )
        assert result["series"][0]["month"] == "2026-01"
        assert result["series"][0]["a"] == 100.0
        assert result["series"][0]["b"] == 50.0
        assert result["series"][1]["a"] == 200.0
        assert result["totals"]["a"] == 300.0
        assert result["totals"]["b"] == 50.0
    finally:
        db.close()


def test_account_compare_income_category():
    init_db()
    db = SessionLocal()
    try:
        create_transaction(db, {
            "txn_date": date(2026, 1, 25),
            "description": "Lön",
            "amount": 42000.0,
            "account": "Konto A",
            "category": "Lön",
            "typ": "Lön",
        })
        create_transaction(db, {
            "txn_date": date(2026, 1, 25),
            "description": "Lön",
            "amount": 38000.0,
            "account": "Konto B",
            "category": "Lön",
            "typ": "Lön",
        })
        result = build_account_compare(
            db,
            account_a="Konto A",
            account_b="Konto B",
            categories=["Lön"],
            months=12,
            chart_max_amount=100000,
        )
        assert result["flow"] == "income"
        assert result["totals"]["a"] == 42000.0
        assert result["totals"]["b"] == 38000.0
    finally:
        db.close()


def test_category_stats_respects_account():
    from app.crud_finance import category_stats

    init_db()
    db = SessionLocal()
    try:
        create_transaction(db, {
            "txn_date": date(2026, 3, 1),
            "description": "ICA",
            "amount": -100.0,
            "account": "Konto A",
            "category": "Livsmedel",
            "typ": "Kortköp",
        })
        create_transaction(db, {
            "txn_date": date(2026, 3, 2),
            "description": "Hyra",
            "amount": -5000.0,
            "account": "Konto B",
            "category": "Boende & Drift",
            "typ": "Autogiro",
        })
        all_stats = {s["category"]: s["total"] for s in category_stats(db, year=2026)}
        a_stats = {s["category"]: s["total"] for s in category_stats(db, year=2026, account="Konto A")}
        assert "Livsmedel" in all_stats
        assert "Boende & Drift" in all_stats
        assert "Livsmedel" in a_stats
        assert "Boende & Drift" not in a_stats
    finally:
        db.close()
