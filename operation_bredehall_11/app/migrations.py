"""Lightweight idempotent SQLite migrations (no Alembic)."""
from __future__ import annotations

import logging

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)


def _column_names(engine: Engine, table: str) -> set[str]:
    insp = inspect(engine)
    if table not in insp.get_table_names():
        return set()
    return {c["name"] for c in insp.get_columns(table)}


def run_migrations(engine: Engine) -> None:
    """Apply schema patches safe to run on every startup."""
    with engine.begin() as conn:
        conn.execute(text("PRAGMA journal_mode=WAL"))

        txn_cols = _column_names(engine, "finance_transactions")
        if txn_cols and "category_locked" not in txn_cols:
            logger.info("Migration: add finance_transactions.category_locked")
            conn.execute(
                text("ALTER TABLE finance_transactions ADD COLUMN category_locked BOOLEAN NOT NULL DEFAULT 0")
            )

        if txn_cols and "amount_ore" not in txn_cols:
            logger.info("Migration: add finance_transactions.amount_ore")
            conn.execute(text("ALTER TABLE finance_transactions ADD COLUMN amount_ore INTEGER"))
            conn.execute(
                text("UPDATE finance_transactions SET amount_ore = CAST(ROUND(amount * 100) AS INTEGER) WHERE amount_ore IS NULL")
            )

        loan_cols = _column_names(engine, "finance_loans")
        if loan_cols and "amount_ore" not in loan_cols:
            logger.info("Migration: add finance_loans.amount_ore")
            conn.execute(text("ALTER TABLE finance_loans ADD COLUMN amount_ore INTEGER"))
            conn.execute(
                text("UPDATE finance_loans SET amount_ore = CAST(ROUND(amount * 100) AS INTEGER) WHERE amount_ore IS NULL")
            )
