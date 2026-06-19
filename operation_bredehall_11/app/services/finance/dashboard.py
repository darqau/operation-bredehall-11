"""Dashboard aggregations with filters for finance analysis."""
from __future__ import annotations

from collections import defaultdict
from datetime import date
from typing import Any, Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import FinanceLoan, FinanceTransaction
from app.services.finance.config import account_number_for, get_finance_config


def _month_key(d: date) -> str:
    return f"{d.year}-{d.month:02d}"


_CHART_EXCLUDED_CATEGORIES = frozenset({"Överföring", "Bostadsköp (engång)"})


def _chart_desc_key(description: str) -> str:
    return " ".join((description or "").split()).casefold()


def _is_chart_excluded(
    txn: FinanceTransaction,
    *,
    exclude_overforing: bool,
    chart_max_amount: Optional[float],
) -> bool:
    if exclude_overforing and txn.typ == "Överföring":
        return True
    if txn.category in _CHART_EXCLUDED_CATEGORIES:
        return True
    desc = _chart_desc_key(txn.description)
    if "slutlikvid" in desc:
        return True
    if chart_max_amount and chart_max_amount > 0 and abs(txn.amount) > chart_max_amount:
        return True
    return False


def _shift_month(year: int, month: int, delta: int) -> tuple[int, int]:
    idx = year * 12 + (month - 1) + delta
    return idx // 12, idx % 12 + 1


def _latest_balance_per_account(db: Session) -> Dict[str, float]:
    """Latest bank-reported balance per account (tie-break: highest id on max date)."""
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
        .order_by(FinanceTransaction.account.asc(), FinanceTransaction.id.desc())
        .all()
    )
    latest: Dict[str, float] = {}
    for r in bal_rows:
        if r.account in latest:
            continue
        if r.balance is not None:
            latest[r.account] = r.balance
    return latest


def _months_ago(d: date, months: int) -> date:
    """Same day-of-month roughly `months` back, clamped to a valid day."""
    y, m = _shift_month(d.year, d.month, -months)
    # Clamp day to the last valid day of the target month.
    for day in (d.day, 28, 29, 30, 31):
        try:
            return date(y, m, day)
        except ValueError:
            continue
    return date(y, m, 1)


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
        from app.crud_finance import escape_like

        escaped = escape_like(search.strip())
        q = q.filter(FinanceTransaction.description.ilike(f"%{escaped}%", escape="\\"))
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
    cfg = get_finance_config()
    account_numbers = cfg.get("account_numbers") or {}
    accounts = [r[0] for r in db.query(FinanceTransaction.account).distinct().order_by(FinanceTransaction.account).all()]
    categories = [r[0] for r in db.query(FinanceTransaction.category).distinct().order_by(FinanceTransaction.category).all()]
    typs = [r[0] for r in db.query(FinanceTransaction.typ).distinct().order_by(FinanceTransaction.typ).all()]
    year_rows = db.query(FinanceTransaction.txn_date).distinct().all()
    years = sorted({r[0].year for r in year_rows if r[0]}, reverse=True)
    min_max = db.query(func.min(FinanceTransaction.txn_date), func.max(FinanceTransaction.txn_date)).first()
    return {
        "accounts": [
            {"name": a, "account_number": account_number_for(a, cfg)}
            for a in accounts
        ],
        "account_numbers": account_numbers,
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
    chart_max_amount: Optional[float] = 100000,
) -> Dict[str, Any]:
    # year=None means "all years" so charts span the full history (2023-2026 etc.)
    use_year = year
    cfg = get_finance_config()

    def _num(name: str) -> str:
        return account_number_for(name, cfg)

    # Balances: always all accounts (unfiltered) for overview
    latest_balances = _latest_balance_per_account(db)

    accounts = [
        {"name": n, "balance": b, "account_number": _num(n)}
        for n, b in sorted(latest_balances.items())
    ]
    total_balance = sum(latest_balances.values())

    # Per-account activity span for the timeline chart (always unfiltered).
    span_rows = (
        db.query(
            FinanceTransaction.account,
            func.min(FinanceTransaction.txn_date),
            func.max(FinanceTransaction.txn_date),
        )
        .group_by(FinanceTransaction.account)
        .all()
    )
    account_timeline = [
        {
            "account": acc,
            "account_number": _num(acc),
            "first_date": first.isoformat() if first else None,
            "last_date": last.isoformat() if last else None,
            "balance": latest_balances.get(acc),
        }
        for acc, first, last in span_rows
        if first and last
    ]
    account_timeline.sort(key=lambda x: x["last_date"], reverse=True)

    # Balance over time per account: monthly last-known balance, forward-filled.
    bal_txns = (
        db.query(FinanceTransaction)
        .filter(FinanceTransaction.balance.isnot(None))
        .order_by(FinanceTransaction.txn_date.asc(), FinanceTransaction.id.asc())
        .all()
    )
    acc_month_bal: Dict[str, Dict[str, float]] = defaultdict(dict)
    for t in bal_txns:
        acc_month_bal[t.account][_month_key(t.txn_date)] = t.balance
    balance_months = sorted({m for d in acc_month_bal.values() for m in d})
    account_balance_series = []
    for acc in sorted(acc_month_bal.keys()):
        mb = acc_month_bal[acc]
        points: List[Optional[float]] = []
        last_val: Optional[float] = None
        for m in balance_months:
            if m in mb:
                last_val = mb[m]
            points.append(round(last_val, 2) if last_val is not None else None)
        account_balance_series.append({"account": acc, "account_number": _num(acc), "points": points})

    txns = _base_query(
        db, account, category, typ, use_year, date_from, date_to, exclude_overforing, search, max_amount
    ).order_by(FinanceTransaction.txn_date.asc()).all()

    monthly_expenses: Dict[str, float] = defaultdict(float)
    monthly_income: Dict[str, float] = defaultdict(float)
    monthly_net: Dict[str, float] = defaultdict(float)
    category_totals: Dict[str, float] = defaultdict(float)
    typ_totals: Dict[str, float] = defaultdict(float)
    chart_dedup_seen: set[tuple] = set()
    chart_capped_count = 0

    for t in txns:
        mk = _month_key(t.txn_date)
        typ_totals[t.typ] = typ_totals.get(t.typ, 0) + t.amount
        if t.amount < 0:
            category_totals[t.category] += t.amount

        if _is_chart_excluded(t, exclude_overforing=exclude_overforing, chart_max_amount=chart_max_amount):
            if chart_max_amount and chart_max_amount > 0 and abs(t.amount) > chart_max_amount:
                chart_capped_count += 1
            continue

        dedup_key = (t.txn_date, round(t.amount, 2), _chart_desc_key(t.description))
        if dedup_key in chart_dedup_seen:
            continue
        chart_dedup_seen.add(dedup_key)

        monthly_net[mk] += t.amount
        if t.amount < 0:
            monthly_expenses[mk] += t.amount
        elif t.amount > 0:
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
            "chart_max_amount": chart_max_amount,
        },
        "chart_excludes": {
            "capped_count": chart_capped_count,
            "excluded_categories": sorted(_CHART_EXCLUDED_CATEGORIES),
            "chart_max_amount": chart_max_amount,
        },
        "total_balance": round(total_balance, 2),
        "accounts": accounts,
        "account_timeline": account_timeline,
        "balance_months": balance_months,
        "account_balance_series": account_balance_series,
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
                "account_number": _num(t.account),
                "typ": t.typ,
                "category": t.category,
            }
            for t in recent
        ],
        "transaction_count": db.query(FinanceTransaction).count(),
    }


def build_hero(db: Session, exclude_internal: bool = True) -> Dict[str, Any]:
    """High-level overview for the finance hero dashboard.

    Returns total assets, average monthly net income (all-time + rolling 3/12
    month averages) and the top expense categories for the last month and the
    last 12 months. Internal transfers ("Överföring") are excluded from income,
    expense and net figures when ``exclude_internal`` is True (the default).
    """
    # ── Current total assets (latest balance per account) ───────────────
    latest_balances = _latest_balance_per_account(db)
    total_assets = round(sum(latest_balances.values()), 2)

    loans = db.query(FinanceLoan).order_by(FinanceLoan.account_number.asc()).all()
    total_debts = round(sum(l.amount for l in loans), 2)
    net_worth = round(total_assets - total_debts, 2)

    # ── Monthly net income (income − expense, excluding internal transfers) ─
    q = db.query(FinanceTransaction)
    if exclude_internal:
        q = q.filter(FinanceTransaction.typ != "Överföring")
    txns = q.order_by(FinanceTransaction.txn_date.asc()).all()

    monthly_net: Dict[str, float] = defaultdict(float)
    for t in txns:
        monthly_net[_month_key(t.txn_date)] += t.amount

    net_avg = {"avg_total": 0.0, "avg_3m": 0.0, "avg_12m": 0.0, "months": 0}
    if monthly_net:
        max_date = max(t.txn_date for t in txns)
        first_date = min(t.txn_date for t in txns)

        # Build a continuous month series from first to last (gaps count as 0).
        series: List[float] = []
        y, m = first_date.year, first_date.month
        while (y, m) <= (max_date.year, max_date.month):
            series.append(round(monthly_net.get(f"{y}-{m:02d}", 0.0), 2))
            y, m = _shift_month(y, m, 1)

        def _avg(values: List[float]) -> float:
            return round(sum(values) / len(values), 2) if values else 0.0

        net_avg = {
            "avg_total": _avg(series),
            "avg_3m": _avg(series[-3:]),
            "avg_12m": _avg(series[-12:]),
            "months": len(series),
        }

    # ── Top expense categories: last month + last 12 months ─────────────
    def _top_expenses(since: Optional[date]) -> List[Dict[str, Any]]:
        totals: Dict[str, float] = defaultdict(float)
        for t in txns:
            if t.amount >= 0:
                continue
            if since and t.txn_date < since:
                continue
            totals[t.category] += t.amount
        ranked = sorted(
            ({"category": k, "amount": round(abs(v), 2)} for k, v in totals.items()),
            key=lambda x: x["amount"],
            reverse=True,
        )
        return ranked[:5]

    month_since = year_since = None
    month_label = year_label = None
    if txns:
        max_date = max(t.txn_date for t in txns)
        month_since = _months_ago(max_date, 1)
        year_since = _months_ago(max_date, 12)
        month_label = f"Senaste 30 dagarna ({month_since.isoformat()} → {max_date.isoformat()})"
        year_label = f"Senaste 12 mån ({year_since.isoformat()} → {max_date.isoformat()})"

    cfg = get_finance_config()
    recent_rows = (
        db.query(FinanceTransaction)
        .order_by(FinanceTransaction.txn_date.desc(), FinanceTransaction.id.desc())
        .limit(5)
        .all()
    )

    return {
        "total_assets": total_assets,
        "total_debts": total_debts,
        "net_worth": net_worth,
        "loans": [
            {
                "id": l.id,
                "label": l.label,
                "account_number": l.account_number,
                "amount": round(l.amount, 2),
                "typ": l.typ,
                "notes": l.notes,
                "updated_at": l.updated_at.isoformat() if l.updated_at else None,
            }
            for l in loans
        ],
        "net_income": net_avg,
        "top_expenses_month": _top_expenses(month_since),
        "top_expenses_year": _top_expenses(year_since),
        "month_label": month_label,
        "year_label": year_label,
        "exclude_internal": exclude_internal,
        "recent_transactions": [
            {
                "id": t.id,
                "txn_date": t.txn_date.isoformat(),
                "description": t.description,
                "amount": t.amount,
                "account": t.account,
                "account_number": account_number_for(t.account, cfg),
                "typ": t.typ,
                "category": t.category,
            }
            for t in recent_rows
        ],
    }
