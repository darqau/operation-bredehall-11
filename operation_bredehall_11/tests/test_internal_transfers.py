from datetime import date

from app.crud_finance import detect_internal_transfers
from app.database import SessionLocal
from app.models import FinanceTransaction


def test_internal_transfer_requires_text_signal():
    db = SessionLocal()
    d = date(2025, 3, 1)
    db.add(FinanceTransaction(
        txn_date=d, amount=-500.0, description="Random shop",
        account="A", typ="Utgift", category="Övrigt", amount_ore=-50000,
    ))
    db.add(FinanceTransaction(
        txn_date=d, amount=500.0, description="Other income",
        account="B", typ="Inkomst", category="Övrigt", amount_ore=50000,
    ))
    db.commit()
    changed = detect_internal_transfers(db, own_accounts_regex="")
    assert changed == 0
    db.query(FinanceTransaction).delete()
    db.commit()
    db.close()


def test_internal_transfer_with_overfor_text():
    db = SessionLocal()
    d = date(2025, 3, 1)
    db.add(FinanceTransaction(
        txn_date=d, amount=-500.0, description="Överföring sparkonto",
        account="A", typ="Utgift", category="Övrigt", amount_ore=-50000,
    ))
    db.add(FinanceTransaction(
        txn_date=d, amount=500.0, description="Överföring",
        account="B", typ="Inkomst", category="Övrigt", amount_ore=50000,
    ))
    db.commit()
    changed = detect_internal_transfers(db, own_accounts_regex="")
    assert changed == 2
    db.query(FinanceTransaction).delete()
    db.commit()
    db.close()
