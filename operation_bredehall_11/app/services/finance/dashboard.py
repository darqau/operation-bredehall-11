"""Dashboard aggregations with filters for finance analysis."""
from __future__ import annotations

from collections import defaultdict
from datetime import date
from typing import Any, Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import FinanceTransaction


def _month_key(d: date) -> str:
    return f"{d.year}-{d.month:02d}"


def _base_query(
    db: Session,
    account: Optional[str] = None,
    category: Optional[str] = None,
    typ: Optional[str] = None,
    year: Optional[int] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    exclude_overforing: bool = False,
    search: Optional[str] = None,
    max_amount: Optional[float] = None,
):
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
    if max_amount and max_amount > 0:
        q = q.filter(func.abs(FinanceTransaction.amount) <= max_amount)
    return q


def build_meta(db: Session) -> Dict[str, Any]:
    accounts = [r[0] for r in db.query(FinanceTransaction.account).distinct().order_by(FinanceTransaction.account).all()]
    categories = [r[0] for r in db.query(FinanceTransaction.category).distinct().order_by(FinanceTransaction.category).all()]
    typs = [r[0] for r in db.query(FinanceTransaction.typ).distinct().order_by(FinanceTransaction.typ).all()]
    year_rows = db.query(FinanceTransaction.txn_date).distinct().all()
    years = sorted({r[0].year for r in year_rows if r[0]}, reverse=True)
    min_max = db.query(func.min(FinanceTransaction.txn_date), func.max(FinanceTransaction.txn_date)).first()
    return {
        "accounts": accounts,
        "categories": categories,
        "typs": typs,
        "years": years,
        "date_min": min_max[0].isoformat() if min_max and min_max[0] else None,
        "date_max": min_max[1].isoformat() if min_max and min_max[1] else None,
        "transaction_count": db.query(FinanceTransaction).count(),
    }


def build_dashboard(
    db: Session,
    year: Optional[int] = None,
    account: Optional[str] = None,
    category: Optional[str] = None,
    typ: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    exclude_overforing: bool = False,
    search: Optional[str] = None,
    max_amount: Optional[float] = None,
) -> Dict[str, Any]:
    # year=None means "all years" so charts span the full history (2023-2026 etc.)
    use_year = year

    # Balances: always all accounts (unfiltered) for overview
    latest_balances: Dict[str, float] = {}
    subq = (
        db.query(
            FinanceTransaction.account,
            func.max(FinanceTransaction.txn_date).label("max_date"),
        )
        .group_by(FinanceTransaction.account)
        .subquery()
    )
    bal_rows = (
        db.query(FinanceTransaction)
        .join(
            subq,
            (FinanceTransaction.account == subq.c.account)
            & (FinanceTransaction.txn_date == subq.c.max_date),
        )
        .order_by(FinanceTransaction.account)
        .all()
    )
    for r in bal_rows:
        if r.balance is not None:
            latest_balances[r.account] = r.balance

    accounts = [{"name": n, "balance": b} for n, b in sorted(latest_balances.items())]
    total_balance = sum(latest_balances.values())

    txns = _base_query(
        db, account, category, typ, use_year, date_from, date_to, exclude_overforing, search, max_amount
    ).order_by(FinanceTransaction.txn_date.asc()).all()

    monthly_expenses: Dict[str, float] = defaultdict(float)
    monthly_income: Dict[str, float] = defaultdict(float)
    monthly_net: Dict[str, float] = defaultdict(float)
    category_totals: Dict[str, float] = defaultdict(float)
    typ_totals: Dict[str, float] = defaultdict(float)

    for t in txns:
        mk = _month_key(t.txn_date)
        monthly_net[mk] += t.amount
        typ_totals[t.typ] = typ_totals.get(t.typ, 0) + t.amount
        if t.amount < 0:
            monthly_expenses[mk] += t.amount
            category_totals[t.category] += t.amount
        elif t.amount > 0 and t.typ != "Överföring":
            monthly_income[mk] += t.amount

    months_sorted = sorted(set(monthly_net.keys()) | set(monthly_expenses.keys()) | set(monthly_income.keys()))
    net_series = [{"month": m, "amount": round(monthly_net.get(m, 0), 2)} for m in months_sorted]
    expense_series = [{"month": m, "amount": round(monthly_expenses.get(m, 0), 2)} for m in months_sorted]
    income_series = [{"month": m, "amount": round(monthly_income.get(m, 0), 2)} for m in months_sorted]

    top_categories = sorted(
        [{"category": k, "amount": round(v, 2)} for k, v in category_totals.items()],
        key=lambda x: x["amount"],
    )[:15]

    filtered_count = len(txns)
    sum_income = round(sum(t.amount for t in txns if t.amount > 0 and t.typ != "Överföring"), 2)
    sum_expense = round(sum(t.amount for t in txns if t.amount < 0), 2)
    sum_net = round(sum(t.amount for t in txns if t.typ != "Överföring"), 2)

    recent = sorted(txns, key=lambda t: (t.txn_date, t.id), reverse=True)[:50]

    return {
        "year": use_year,
        "filters": {
            "account": account,
            "category": category,
            "typ": typ,
            "date_from": date_from.isoformat() if date_from else None,
            "date_to": date_to.isoformat() if date_to else None,
            "exclude_overforing": exclude_overforing,
            "search": search,
            "max_amount": max_amount,
        },
        "total_balance": round(total_balance, 2),
        "accounts": accounts,
        "summary": {
            "income": sum_income,
            "expense": sum_expense,
            "net": sum_net,
            "count": filtered_count,
        },
        "net_income_over_time": net_series,
        "monthly_expenses": expense_series,
        "monthly_income": income_series,
        "expenses_by_category": top_categories,
        "by_typ": [{"typ": k, "amount": round(v, 2)} for k, v in sorted(typ_totals.items(), key=lambda x: -abs(x[1]))],
        "recent_transactions": [
            {
                "id": t.id,
                "txn_date": t.txn_date.isoformat(),
                "description": t.description,
                "amount": t.amount,
                "balance": t.balance,
                "account": t.account,
                "typ": t.typ,
                "category": t.category,
            }
            for t in recent
        ],
        "transaction_count": db.query(FinanceTransaction).count(),
    }
