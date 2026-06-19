"""Seed initial bolån if finance_loans table is empty."""
from __future__ import annotations

from sqlalchemy import text

from app.crud_finance import create_loan
from app.database import SessionLocal, engine, init_db


DEFAULT_LOANS = [
    {"label": "Bolån Nordea", "account_number": "3993 65 18128", "amount": 1352200.0, "typ": "bolån"},
    {"label": "Bolån Nordea", "account_number": "3993 65 18136", "amount": 1352200.0, "typ": "bolån"},
    {"label": "Bolån Nordea", "account_number": "3993 65 18144", "amount": 586500.0, "typ": "bolån"},
    {"label": "Bolån Nordea", "account_number": "3993 65 18152", "amount": 586500.0, "typ": "bolån"},
]


def seed_loans_if_empty() -> None:
    init_db()
    with engine.connect() as conn:
        try:
            count = conn.execute(text("SELECT COUNT(*) FROM finance_loans")).scalar() or 0
        except Exception:
            return
    if count > 0:
        return

    db = SessionLocal()
    try:
        for row in DEFAULT_LOANS:
            create_loan(db, row)
    finally:
        db.close()
