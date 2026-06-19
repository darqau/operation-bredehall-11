"""CRUD for finance transactions."""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime
from typing import List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import FinanceLoan, FinanceTransaction


def transaction_fingerprint(
    account: str,
    txn_date: date,
    amount: float,
    description: str,
) -> tuple:
    """Stable identity for a bank transaction on one account.

    Overlapping CSV exports from the same bank repeat the same rows; matching
    on account + date + amount + normalised description is enough to skip them.
    """
    desc = " ".join((description or "").split()).casefold()
    return (account, txn_date, round(float(amount), 2), desc)


def _fingerprint_from_row(row: dict) -> tuple:
    return transaction_fingerprint(
        row["account"],
        row["txn_date"],
        row["amount"],
        row.get("description") or "",
    )


def _fingerprint_from_model(txn: FinanceTransaction) -> tuple:
    return transaction_fingerprint(
        txn.account,
        txn.txn_date,
        txn.amount,
        txn.description,
    )


def load_existing_fingerprints(db: Session, accounts: Optional[set[str]] = None) -> set[tuple]:
    """Fingerprints of non-manual transactions already stored (optionally per account)."""
    q = db.query(FinanceTransaction).filter(FinanceTransaction.is_manual == False)  # noqa: E712
    if accounts:
        q = q.filter(FinanceTransaction.account.in_(accounts))
    return {_fingerprint_from_model(t) for t in q.all()}


def _apply_txn_filters(q, *, account=None, category=None, typ=None, year=None,
                       date_from=None, date_to=None, search=None,
                       exclude_overforing=False, max_amount=None):
    """Shared filtering used by both list_transactions and count_transactions."""
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
    if max_amount and max_amount > 0:
        q = q.filter(func.abs(FinanceTransaction.amount) <= max_amount)
    return q


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


def create_transactions_bulk(db: Session, rows: List[dict]) -> dict:
    """Insert parsed CSV rows, skipping duplicates already in DB or repeated in batch."""
    if not rows:
        return {"added": 0, "skipped": 0}

    accounts = {r["account"] for r in rows if not r.get("is_manual")}
    seen = load_existing_fingerprints(db, accounts or None)
    today = date.today()
    objects: List[FinanceTransaction] = []
    skipped = 0

    for r in rows:
        if r.get("is_manual"):
            objects.append(
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
                    is_manual=True,
                    created_at=today,
                )
            )
            continue

        fp = _fingerprint_from_row(r)
        if fp in seen:
            skipped += 1
            continue
        seen.add(fp)
        objects.append(
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
                is_manual=False,
                created_at=today,
            )
        )

    if objects:
        db.add_all(objects)
        db.commit()
    return {"added": len(objects), "skipped": skipped}


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
    max_amount: Optional[float] = None,
    sort_by: str = "txn_date",
    sort_dir: str = "desc",
    limit: int = 100,
    offset: int = 0,
) -> List[FinanceTransaction]:
    q = _apply_txn_filters(
        db.query(FinanceTransaction),
        account=account, category=category, typ=typ, year=year,
        date_from=date_from, date_to=date_to, search=search,
        exclude_overforing=exclude_overforing, max_amount=max_amount,
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
    q = _apply_txn_filters(
        db.query(FinanceTransaction),
        account=filters.get("account"),
        category=filters.get("category"),
        typ=filters.get("typ"),
        year=filters.get("year"),
        date_from=filters.get("date_from"),
        date_to=filters.get("date_to"),
        search=filters.get("search"),
        exclude_overforing=filters.get("exclude_overforing", False),
        max_amount=filters.get("max_amount"),
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


def detect_internal_transfers(db: Session, date_window_days: int = 3) -> int:
    """Mark transactions that move money between two of our own accounts as
    internal transfers ("Överföring").

    A transfer between two own accounts always produces two legs: a debit in
    one account and a matching credit in another. We pair a negative amount in
    account A with an unused positive amount of the same magnitude in a
    *different* account whose date is within ``date_window_days``. Both legs are
    then categorised as "Överföring" so they no longer count as income/expense.

    This is more robust than matching sender/receiver text because the pairing
    works even when the bank export leaves those fields empty. Runs over the
    full history and is idempotent (rows already tagged "Överföring" are left
    untouched).
    """
    txns = (
        db.query(FinanceTransaction)
        .order_by(FinanceTransaction.txn_date.asc(), FinanceTransaction.id.asc())
        .all()
    )

    # Index candidate credit legs by their rounded magnitude.
    positives: dict[float, list[FinanceTransaction]] = defaultdict(list)
    for t in txns:
        if t.amount > 0:
            positives[round(t.amount, 2)].append(t)

    used_credit_ids: set[int] = set()
    changed = 0

    for debit in txns:
        if debit.amount >= 0:
            continue
        key = round(-debit.amount, 2)
        candidates = positives.get(key)
        if not candidates:
            continue

        best: Optional[FinanceTransaction] = None
        best_diff: Optional[int] = None
        for credit in candidates:
            if credit.id in used_credit_ids or credit.account == debit.account:
                continue
            diff = abs((credit.txn_date - debit.txn_date).days)
            if diff <= date_window_days and (best_diff is None or diff < best_diff):
                best, best_diff = credit, diff
                if diff == 0:
                    break

        if best is None:
            continue

        used_credit_ids.add(best.id)
        for leg in (debit, best):
            if leg.typ != "Överföring" or leg.category != "Överföring":
                leg.typ = "Överföring"
                leg.category = "Överföring"
                changed += 1

    db.commit()
    return changed


def get_uncategorized(db: Session, limit: int = 2000, offset: int = 0) -> List[FinanceTransaction]:
    return (
        db.query(FinanceTransaction)
        .filter(FinanceTransaction.category == "Övrigt", FinanceTransaction.is_manual == False)  # noqa: E712
        .order_by(FinanceTransaction.txn_date.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )


def count_uncategorized(db: Session) -> int:
    return (
        db.query(FinanceTransaction)
        .filter(FinanceTransaction.category == "Övrigt", FinanceTransaction.is_manual == False)  # noqa: E712
        .count()
    )


def update_transaction_category(db: Session, txn_id: int, category: str) -> Optional[FinanceTransaction]:
    t = db.query(FinanceTransaction).filter(FinanceTransaction.id == txn_id).first()
    if not t:
        return None
    t.category = category.strip()
    db.commit()
    db.refresh(t)
    return t


def category_stats(
    db: Session,
    year: Optional[int] = None,
    month: Optional[int] = None,
    expenses_only: bool = True,
) -> List[dict]:
    q = db.query(
        FinanceTransaction.category,
        func.count(FinanceTransaction.id),
        func.sum(FinanceTransaction.amount),
    ).group_by(FinanceTransaction.category)
    if expenses_only:
        q = q.filter(FinanceTransaction.amount < 0)
    if year:
        q = q.filter(func.strftime("%Y", FinanceTransaction.txn_date) == str(year))
    if month and year:
        q = q.filter(func.strftime("%m", FinanceTransaction.txn_date) == f"{month:02d}")
    rows = q.order_by(func.count(FinanceTransaction.id).desc()).all()
    return [
        {"category": cat, "count": cnt, "total": round(float(total or 0), 2)}
        for cat, cnt, total in rows
    ]


def apply_category_mapping(db: Session, mapping: dict) -> dict:
    """Apply id→category mapping. Returns {changed, by_category}."""
    by_category: dict = {}
    changed = 0
    for tid, cat in mapping.items():
        if not cat or cat == "Övrigt":
            continue
        t = db.query(FinanceTransaction).filter(FinanceTransaction.id == int(tid)).first()
        if t and t.category != cat:
            t.category = cat
            changed += 1
            by_category[cat] = by_category.get(cat, 0) + 1
    db.commit()
    return {"changed": changed, "by_category": by_category}


# ── Loans / debts ─────────────────────────────────────────────────────


def list_loans(db: Session) -> List[FinanceLoan]:
    return db.query(FinanceLoan).order_by(FinanceLoan.account_number.asc()).all()


def get_loan(db: Session, loan_id: int) -> Optional[FinanceLoan]:
    return db.query(FinanceLoan).filter(FinanceLoan.id == loan_id).first()


def get_loan_by_account(db: Session, account_number: str) -> Optional[FinanceLoan]:
    return db.query(FinanceLoan).filter(FinanceLoan.account_number == account_number.strip()).first()


def create_loan(db: Session, row: dict) -> FinanceLoan:
    loan = FinanceLoan(
        label=(row.get("label") or "Bolån").strip(),
        account_number=(row["account_number"] or "").strip(),
        amount=float(row["amount"]),
        typ=(row.get("typ") or "bolån").strip(),
        notes=(row.get("notes") or None),
        updated_at=datetime.utcnow(),
    )
    db.add(loan)
    db.commit()
    db.refresh(loan)
    return loan


def update_loan(db: Session, loan_id: int, row: dict) -> Optional[FinanceLoan]:
    loan = get_loan(db, loan_id)
    if not loan:
        return None
    if "label" in row and row["label"] is not None:
        loan.label = row["label"].strip()
    if "account_number" in row and row["account_number"] is not None:
        loan.account_number = row["account_number"].strip()
    if "amount" in row and row["amount"] is not None:
        loan.amount = float(row["amount"])
    if "typ" in row and row["typ"] is not None:
        loan.typ = row["typ"].strip()
    if "notes" in row:
        loan.notes = row["notes"]
    loan.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(loan)
    return loan


def delete_loan(db: Session, loan_id: int) -> bool:
    loan = get_loan(db, loan_id)
    if not loan:
        return False
    db.delete(loan)
    db.commit()
    return True


def upsert_loans(db: Session, rows: List[dict]) -> dict:
    """Insert or update loans matched by account_number."""
    created = 0
    updated = 0
    items: List[FinanceLoan] = []
    for row in rows:
        account = (row.get("account_number") or "").strip()
        if not account:
            continue
        existing = get_loan_by_account(db, account)
        payload = {
            "label": (row.get("label") or "Bolån").strip(),
            "account_number": account,
            "amount": float(row["amount"]),
            "typ": (row.get("typ") or "bolån").strip(),
            "notes": row.get("notes"),
        }
        if existing:
            update_loan(db, existing.id, payload)
            updated += 1
            items.append(get_loan(db, existing.id))
        else:
            items.append(create_loan(db, payload))
            created += 1
    total = sum_loans(db)
    return {
        "created": created,
        "updated": updated,
        "total_debt": total,
        "items": items,
    }


def sum_loans(db: Session) -> float:
    total = db.query(func.coalesce(func.sum(FinanceLoan.amount), 0.0)).scalar()
    return round(float(total or 0), 2)


_CROSS_ACCOUNT_DEDUP_KEYWORDS = ("slutlikvid", "omsättning lån", "omsattning lan", "extraamortering")


def _normalized_description(description: str) -> str:
    return " ".join((description or "").split()).casefold()


def _is_cross_account_dedup_candidate(description: str) -> bool:
    desc = _normalized_description(description)
    return any(kw in desc for kw in _CROSS_ACCOUNT_DEDUP_KEYWORDS)


def migrate_house_purchase_duplicates(db: Session) -> dict:
    """Remove cross-account duplicate house/loan rows and fix miscategorised tags."""
    preferred_account = "Gemensamt Nordea"
    retagged_extra = 0
    retagged_slut = 0
    deduped = 0

    for txn in db.query(FinanceTransaction).all():
        desc_cf = _normalized_description(txn.description)
        if "extraamortering" in desc_cf:
            if txn.typ != "Överföring" or txn.category != "Överföring":
                txn.typ = "Överföring"
                txn.category = "Överföring"
                retagged_extra += 1
        if "slutlikvid" in desc_cf:
            if txn.category != "Bostadsköp (engång)":
                txn.category = "Bostadsköp (engång)"
                retagged_slut += 1

    groups: dict[tuple, list[FinanceTransaction]] = defaultdict(list)
    for txn in db.query(FinanceTransaction).order_by(FinanceTransaction.id).all():
        if not _is_cross_account_dedup_candidate(txn.description):
            continue
        key = (txn.txn_date, round(float(txn.amount), 2), _normalized_description(txn.description))
        groups[key].append(txn)

    for txns in groups.values():
        if len(txns) <= 1:
            continue
        keep = next((t for t in txns if t.account == preferred_account), txns[0])
        for txn in txns:
            if txn.id != keep.id:
                db.delete(txn)
                deduped += 1

    db.commit()
    return {
        "retagged_extraamortering": retagged_extra,
        "retagged_slutlikvid": retagged_slut,
        "deduped": deduped,
    }


def migrate_patrik_lonekonto_transactions(db: Session) -> dict:
    """Move 1127 21 36671 CSV imports to Patriks Lönekonto and remove duplicates."""
    target = "Patriks Lönekonto"
    pattern = "%1127%36671%"

    moved = (
        db.query(FinanceTransaction)
        .filter(
            FinanceTransaction.source_file.ilike(pattern),
            FinanceTransaction.account != target,
        )
        .update({FinanceTransaction.account: target}, synchronize_session=False)
    )

    seen: set[tuple] = set()
    deduped = 0
    rows = (
        db.query(FinanceTransaction)
        .filter(
            FinanceTransaction.account == target,
            FinanceTransaction.is_manual == False,  # noqa: E712
        )
        .order_by(FinanceTransaction.id)
        .all()
    )
    for txn in rows:
        fp = _fingerprint_from_model(txn)
        if fp in seen:
            db.delete(txn)
            deduped += 1
        else:
            seen.add(fp)

    db.commit()
    return {"moved": moved, "deduped": deduped, "total": len(seen)}
