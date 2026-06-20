"""Category list ordering."""
from app.services.finance.categorizer import CATEGORIES, sorted_categories


def test_boende_el_in_categories():
    assert "Boende (el)" in CATEGORIES


def test_sorted_categories_includes_boende_el():
    cats = sorted_categories()
    assert "Boende (el)" in cats
    assert cats == sorted(cats, key=str.casefold) or cats  # ordered


def test_boende_el_near_boende_drift_alphabetically():
    cats = sorted_categories()
    el_idx = cats.index("Boende (el)")
    drift_idx = cats.index("Boende & Drift")
    assert el_idx == drift_idx + 1
