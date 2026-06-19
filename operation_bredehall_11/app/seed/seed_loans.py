"""Seed demo bolån only when explicitly requested."""
from __future__ import annotations

import os

from sqlalchemy import text

from app.crud_finance import create_loan
from app.database import SessionLocal, engine, init_db

DEMO_LOANS = [
    {"label": "Bolån (exempel)", "account_number": "3993 65 00001", "amount": 1_000_000.0, "typ": "bolån"},
]


def seed_loans_if_empty() -> None:
    if os.environ.get("SEED_DEMO_LOANS") != "1":
        return
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
        for row in DEMO_LOANS:
            create_loan(db, row)
    finally:
        db.close()
