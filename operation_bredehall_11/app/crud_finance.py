"""CRUD for finance transactions."""
from __future__ import annotations

from datetime import date
from typing import List, Optional

from sqlalchemy.orm import Session

from app.models import FinanceTransaction


def create_transaction(db: Session, row: dict) -> FinanceTransaction:
    txn = FinanceTransaction(
        txn_date=row["txn_date"],
        amount=row["amount"],
        description=row.get("description") or "",
        balance=row.get("balance"),
        account=row["account"],
        typ=row.get("typ") or "Övrigt",
        category=row.get("category") or "Övrigt",
        currency=row.get("currency") or "SEK",
        sender=row.get("sender"),
        receiver=row.get("receiver"),
        source_file=row.get("source_file"),
        is_manual=bool(row.get("is_manual", False)),
        created_at=date.today(),
    )
    db.add(txn)
    db.commit()
    db.refresh(txn)
    return txn


def create_transactions_bulk(db: Session, rows: List[dict]) -> int:
    today = date.today()
    objects = [
        FinanceTransaction(
            txn_date=r["txn_date"],
            amount=r["amount"],
            description=r.get("description") or "",
            balance=r.get("balance"),
            account=r["account"],
            typ=r.get("typ") or "Övrigt",
            category=r.get("category") or "Övrigt",
            currency=r.get("currency") or "SEK",
            sender=r.get("sender"),
            receiver=r.get("receiver"),
            source_file=r.get("source_file"),
            is_manual=bool(r.get("is_manual", False)),
            created_at=today,
        )
        for r in rows
    ]
    db.add_all(objects)
    db.commit()
    return len(objects)


def list_transactions(
    db: Session,
    account: Optional[str] = None,
    category: Optional[str] = None,
    typ: Optional[str] = None,
    year: Optional[int] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    search: Optional[str] = None,
    exclude_overforing: bool = False,
    sort_by: str = "txn_date",
    sort_dir: str = "desc",
    limit: int = 100,
    offset: int = 0,
) -> List[FinanceTransaction]:
    q = db.query(FinanceTransaction)
    if account:
        q = q.filter(FinanceTransaction.account == account)
    if category:
        q = q.filter(FinanceTransaction.category == category)
    if typ:
        q = q.filter(FinanceTransaction.typ == typ)
    if exclude_overforing:
        q = q.filter(FinanceTransaction.typ != "Överföring")
    if search:
        q = q.filter(FinanceTransaction.description.ilike(f"%{search.strip()}%"))
    if date_from:
        q = q.filter(FinanceTransaction.txn_date >= date_from)
    if date_to:
        q = q.filter(FinanceTransaction.txn_date <= date_to)
    if year and not date_from and not date_to:
        q = q.filter(
            FinanceTransaction.txn_date >= date(year, 1, 1),
            FinanceTransaction.txn_date <= date(year, 12, 31),
        )

    sort_cols = {
        "txn_date": FinanceTransaction.txn_date,
        "amount": FinanceTransaction.amount,
        "description": FinanceTransaction.description,
        "account": FinanceTransaction.account,
        "category": FinanceTransaction.category,
    }
    col = sort_cols.get(sort_by, FinanceTransaction.txn_date)
    if sort_dir == "asc":
        q = q.order_by(col.asc(), FinanceTransaction.id.asc())
    else:
        q = q.order_by(col.desc(), FinanceTransaction.id.desc())

    return q.offset(offset).limit(limit).all()


def count_transactions(db: Session, **filters) -> int:
    q = db.query(FinanceTransaction)
    account = filters.get("account")
    category = filters.get("category")
    typ = filters.get("typ")
    year = filters.get("year")
    date_from = filters.get("date_from")
    date_to = filters.get("date_to")
    search = filters.get("search")
    exclude_overforing = filters.get("exclude_overforing", False)
    if account:
        q = q.filter(FinanceTransaction.account == account)
    if category:
        q = q.filter(FinanceTransaction.category == category)
    if typ:
        q = q.filter(FinanceTransaction.typ == typ)
    if exclude_overforing:
        q = q.filter(FinanceTransaction.typ != "Överföring")
    if search:
        q = q.filter(FinanceTransaction.description.ilike(f"%{search.strip()}%"))
    if date_from:
        q = q.filter(FinanceTransaction.txn_date >= date_from)
    if date_to:
        q = q.filter(FinanceTransaction.txn_date <= date_to)
    if year and not date_from and not date_to:
        q = q.filter(
            FinanceTransaction.txn_date >= date(year, 1, 1),
            FinanceTransaction.txn_date <= date(year, 12, 31),
        )
    return q.count()


def delete_transaction(db: Session, txn_id: int) -> bool:
    txn = db.query(FinanceTransaction).filter(FinanceTransaction.id == txn_id).first()
    if not txn:
        return False
    db.delete(txn)
    db.commit()
    return True


def clear_all_transactions(db: Session) -> int:
    count = db.query(FinanceTransaction).count()
    db.query(FinanceTransaction).delete()
    db.commit()
    return count


def recategorize_rules(db: Session, own_accounts_regex: str, only_ovrigt: bool = False) -> int:
    """Re-run the rule-based classifier over stored transactions."""
    from app.services.finance.categorizer import categorize, classify_typ

    q = db.query(FinanceTransaction)
    if only_ovrigt:
        q = q.filter(FinanceTransaction.category == "Övrigt")
    changed = 0
    for t in q.all():
        if t.is_manual:
            continue
        new_typ = classify_typ(t.amount, t.description, t.sender, t.receiver, own_accounts_regex)
        new_cat = categorize(t.description, new_typ, amount=t.amount)
        if new_typ != t.typ or new_cat != t.category:
            t.typ = new_typ
            t.category = new_cat
            changed += 1
    db.commit()
    return changed


def get_uncategorized(db: Session, limit: int = 2000) -> List[FinanceTransaction]:
    return (
        db.query(FinanceTransaction)
        .filter(FinanceTransaction.category == "Övrigt", FinanceTransaction.is_manual == False)  # noqa: E712
        .order_by(FinanceTransaction.txn_date.desc())
        .limit(limit)
        .all()
    )


def apply_category_mapping(db: Session, mapping: dict) -> int:
    changed = 0
    for tid, cat in mapping.items():
        t = db.query(FinanceTransaction).filter(FinanceTransaction.id == int(tid)).first()
        if t and cat and t.category != cat:
            t.category = cat
            changed += 1
    db.commit()
    return changed
