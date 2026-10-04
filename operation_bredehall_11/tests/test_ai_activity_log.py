"""AI categorization activity log + locked (historik) list."""
from datetime import date
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.crud_finance import create_transaction, list_locked_transactions
from app.database import SessionLocal
from app.main import app
from app.services.finance.activity_log import list_activity_log, log_finance_activity, parse_activity_details

client = TestClient(app)


def _ovrigt_txn(desc="ICA OSÄKER", amount=-50.0):
    return {
        "txn_date": date(2026, 9, 1),
        "amount": amount,
        "description": desc,
        "account": "Testkonto",
        "typ": "Utgift",
        "category": "Övrigt",
        "balance": 1000.0,
    }


def test_parse_activity_details():
    assert parse_activity_details(None) is None
    assert parse_activity_details('{"items":[{"id":1}]}') == {"items": [{"id": 1}]}
    assert parse_activity_details("not-json") is None


def test_list_activity_log_event_type_filter():
    db = SessionLocal()
    try:
        log_finance_activity(db, event_type="csv_import", summary="import", transaction_count=1)
        log_finance_activity(
            db,
            event_type="ai_categorize",
            summary="AI batch",
            transaction_count=1,
            skipped_count=1,
            details={"items": [{"category": "Övrigt", "is_ovrigt": True}]},
        )
        ai_rows, ai_total = list_activity_log(db, limit=50, offset=0, event_type="ai_categorize")
        assert ai_total >= 1
        assert all(r.event_type == "ai_categorize" for r in ai_rows)
        details = parse_activity_details(ai_rows[0].details)
        assert details and details["items"]
    finally:
        db.close()


def test_list_locked_transactions_only_ovrigt():
    db = SessionLocal()
    try:
        a = create_transaction(db, _ovrigt_txn("Låst Övrigt A"))
        b = create_transaction(db, {**_ovrigt_txn("Låst Livsmedel"), "category": "Livsmedel"})
        a.category_locked = True
        b.category_locked = True
        db.commit()
        rows, total = list_locked_transactions(db, only_ovrigt=True, limit=50, offset=0)
        ids = {r.id for r in rows}
        assert a.id in ids
        assert b.id not in ids
        assert total >= 1
    finally:
        db.close()


def test_ai_batch_writes_activity_log():
    db = SessionLocal()
    try:
        t1 = create_transaction(db, _ovrigt_txn("Willys Test AI"))
        t2 = create_transaction(db, _ovrigt_txn("Okänd Butik XYZ", -12.0))
        tid1, tid2 = t1.id, t2.id
    finally:
        db.close()

    fake_result = {
        "ok": True,
        "mapping": {tid1: "Livsmedel"},
        "skipped": [tid2],
        "reviewed_ids": [tid1, tid2],
        "errors": [],
        "preview": [
            {"id": tid1, "category": "Livsmedel", "confidence": 0.91},
            {"id": tid2, "category": "Övrigt", "confidence": 0.3},
        ],
        "elapsed_seconds": 0.1,
    }
    with patch("app.routers.finance.get_finance_config", return_value={"ai_enabled": True, "ai_batch_size": 5}):
        with patch("app.services.finance.ai_finance.get_ai_settings", return_value={
            "enabled": True, "base_url": "http://x", "api_key": "k", "model": "m",
            "timeout_seconds": 60, "batch_size": 5,
        }):
            with patch("app.services.finance.ai_finance.categorize_batch", return_value=fake_result):
                resp = client.post("/api/finance/ai/batch")
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["changed"] == 1

    db = SessionLocal()
    try:
        rows, _ = list_activity_log(db, limit=20, offset=0, event_type="ai_categorize")
        assert rows
        details = parse_activity_details(rows[0].details)
        assert details and len(details["items"]) == 2
        by_id = {i["transaction_id"]: i for i in details["items"]}
        assert by_id[tid1]["category"] == "Livsmedel"
        assert by_id[tid1]["confidence"] == 0.91
        assert by_id[tid1]["previous_category"] == "Övrigt"
        assert by_id[tid2]["is_ovrigt"] is True
        assert by_id[tid2]["locked"] is True
    finally:
        db.close()

    reviewed = client.get("/api/finance/ai/reviewed?only_ovrigt=true&limit=50")
    assert reviewed.status_code == 200
    ids = {i["id"] for i in reviewed.json()["items"]}
    assert tid2 in ids


def test_activity_log_api_returns_details():
    db = SessionLocal()
    try:
        log_finance_activity(
            db,
            event_type="ai_categorize",
            summary="test",
            details={"items": [{"transaction_id": 1, "category": "Övrigt", "is_ovrigt": True}]},
        )
    finally:
        db.close()
    resp = client.get("/api/finance/activity-log?event_type=ai_categorize&limit=5")
    assert resp.status_code == 200
    data = resp.json()
    assert data["items"]
    assert data["items"][0]["details"]["items"][0]["category"] == "Övrigt"
