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
        source_file="Transaktioner_2025.csv",
    ))
    db.add(FinanceTransaction(
        txn_date=d, amount=-20, description="b", account="T", typ="Utgift",
        category="Övrigt", balance=980.0, amount_ore=-2000,
        source_file="Transaktioner_2025.csv",
    ))
    db.commit()
    balances = _latest_balance_per_account(db)
    assert balances["T"] == 980.0
    db.query(FinanceTransaction).filter(FinanceTransaction.account == "T").delete()
    db.commit()
    db.close()


def test_balance_sparkonto_reverse_chrono_uses_first_imported():
    db = SessionLocal()
    d = date(2025, 12, 31)
    db.add(FinanceTransaction(
        txn_date=d, amount=-80, description="Preliminär skatt 2025", account="CSN", typ="Utgift",
        category="Övrigt", balance=189.19, amount_ore=-8000,
        source_file="SPARKONTO 3100 22 43645.csv",
    ))
    db.add(FinanceTransaction(
        txn_date=d, amount=269.19, description="Ränta 2025", account="CSN", typ="Inkomst",
        category="Övrigt", balance=269.19, amount_ore=26919,
        source_file="SPARKONTO 3100 22 43645.csv",
    ))
    db.commit()
    balances = _latest_balance_per_account(db)
    assert balances["CSN"] == 189.19
    db.query(FinanceTransaction).filter(FinanceTransaction.account == "CSN").delete()
    db.commit()
    db.close()
