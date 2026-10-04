"""Tests for finance activity log."""
from app.database import SessionLocal
from app.services.finance.activity_log import list_activity_log, log_finance_activity


def test_log_and_list_activity():
    db = SessionLocal()
    try:
        log_finance_activity(
            db,
            event_type="csv_import",
            account="Testkonto",
            filename="test.csv",
            transaction_count=3,
            skipped_count=1,
            summary="3 transaktioner importerade till Testkonto",
        )
        rows, total = list_activity_log(db, limit=10, offset=0)
        assert total >= 1
        assert rows[0].event_type == "csv_import"
        assert rows[0].account == "Testkonto"
        assert rows[0].filename == "test.csv"
        assert rows[0].transaction_count == 3
    finally:
        db.close()
