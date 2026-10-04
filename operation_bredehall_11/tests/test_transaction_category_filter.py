"""Transaction list respects category filter (sidebar + compare)."""
from datetime import date

from fastapi.testclient import TestClient

from app.crud_finance import create_transaction
from app.database import SessionLocal
from app.main import app

client = TestClient(app)


def test_transactions_category_singular():
    db = SessionLocal()
    try:
        create_transaction(db, {
            "txn_date": date(2099, 1, 5),
            "description": "Veterinär test",
            "amount": -500.0,
            "account": "Testkonto Kategori",
            "category": "Husdjur",
            "typ": "Kortköp",
        })
        create_transaction(db, {
            "txn_date": date(2099, 1, 6),
            "description": "ICA test",
            "amount": -100.0,
            "account": "Testkonto Kategori",
            "category": "Livsmedel",
            "typ": "Kortköp",
        })
    finally:
        db.close()

    r = client.get("/api/finance/transactions", params={
        "account": "Testkonto Kategori",
        "category": "Husdjur",
        "year": 2099,
    })
    assert r.status_code == 200
    data = r.json()
    assert data["total"] == 1
    assert data["items"][0]["category"] == "Husdjur"


def test_transactions_compare_accounts_with_category():
    db = SessionLocal()
    try:
        create_transaction(db, {
            "txn_date": date(2099, 2, 1),
            "description": "Hundmat test",
            "amount": -200.0,
            "account": "Testkonto Jämför A",
            "category": "Husdjur",
            "typ": "Kortköp",
        })
        create_transaction(db, {
            "txn_date": date(2099, 2, 2),
            "description": "Coop test",
            "amount": -80.0,
            "account": "Testkonto Jämför B",
            "category": "Livsmedel",
            "typ": "Kortköp",
        })
    finally:
        db.close()

    r = client.get("/api/finance/transactions", params={
        "accounts": "Testkonto Jämför A,Testkonto Jämför B",
        "category": "Husdjur",
        "flow": "expense",
        "chart_exclusions": "true",
        "date_from": "2099-02-01",
        "date_to": "2099-02-28",
    })
    assert r.status_code == 200
    data = r.json()
    assert data["total"] == 1
    assert all(i["category"] == "Husdjur" for i in data["items"])
