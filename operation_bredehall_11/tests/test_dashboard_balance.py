from datetime import date

from app.database import SessionLocal
from app.models import FinanceTransaction
from app.services.finance.dashboard import _latest_balance_per_account


def test_balance_tie_break_uses_latest_id():
    db = SessionLocal()
    d = date(2025, 6, 15)
    db.add(FinanceTransaction(
        txn_date=d, amount=-10, description="a", account="T", typ="Utgift",
        category="Övrigt", balance=1000.0, amount_ore=-1000,
    ))
    db.add(FinanceTransaction(
        txn_date=d, amount=-20, description="b", account="T", typ="Utgift",
        category="Övrigt", balance=980.0, amount_ore=-2000,
    ))
    db.commit()
    balances = _latest_balance_per_account(db)
    assert balances["T"] == 980.0
    db.query(FinanceTransaction).filter(FinanceTransaction.account == "T").delete()
    db.commit()
    db.close()
