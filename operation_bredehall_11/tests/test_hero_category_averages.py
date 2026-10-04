"""Rolling category averages in hero."""
from datetime import date

from app.models import FinanceTransaction
from app.services.finance.dashboard import (
    _category_monthly_expenses,
    _continuous_month_series,
    _rolling_averages,
)


def test_category_rolling_averages():
    txns = [
        FinanceTransaction(
            txn_date=date(2026, 1, 15), amount=-3000, description="ICA",
            account="T", typ="Utgift", category="Livsmedel",
        ),
        FinanceTransaction(
            txn_date=date(2026, 2, 15), amount=-5000, description="ICA",
            account="T", typ="Utgift", category="Livsmedel",
        ),
        FinanceTransaction(
            txn_date=date(2026, 2, 20), amount=-1000, description="Bensin",
            account="T", typ="Utgift", category="Bil & Transport",
        ),
    ]
    first = min(t.txn_date for t in txns)
    last = max(t.txn_date for t in txns)
    by_cat = _category_monthly_expenses(txns)

    food_series = _continuous_month_series(by_cat["Livsmedel"], first, last)
    food = _rolling_averages(food_series)
    assert food_series == [3000.0, 5000.0]
    assert food["avg_total"] == 4000.0
    assert food["avg_3m"] == 4000.0

    car = _rolling_averages(_continuous_month_series(by_cat["Bil & Transport"], first, last))
    assert car["avg_total"] == 500.0  # 1000 over Jan-Feb


def test_rolling_with_gap_months():
    txns = [
        FinanceTransaction(
            txn_date=date(2026, 3, 1), amount=-900, description="x",
            account="T", typ="Utgift", category="Övrigt",
        ),
    ]
    by_cat = _category_monthly_expenses(txns)
    series = _continuous_month_series(by_cat["Övrigt"], date(2026, 1, 1), date(2026, 3, 1))
    assert series == [0.0, 0.0, 900.0]
    avgs = _rolling_averages(series)
    assert avgs["avg_total"] == 300.0
    assert avgs["avg_3m"] == 300.0
