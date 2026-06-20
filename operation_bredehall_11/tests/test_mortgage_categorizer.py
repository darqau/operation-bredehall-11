"""Electricity provider categorization."""
from app.services.finance.categorizer import categorize, enrich_transaction, is_el_expense


def test_omsattning_lan_is_housing_expense():
    row = {
        "amount": -6045.0,
        "description": "Omsättning lån 3993 65 18136",
        "account": "Gemensamt Nordea",
    }
    enriched = enrich_transaction(row, own_accounts_regex="")
    assert enriched["typ"] == "Utgift"
    assert enriched["category"] == "Boende & Drift"


def test_goteborg_energi_is_el_category():
    row = {"amount": -890.0, "description": "Autogiro Göteborg Energi", "account": "Gemensamt Nordea"}
    enriched = enrich_transaction(row, own_accounts_regex="")
    assert enriched["category"] == "Boende (el)"


def test_goteborg_energi_ascii_spelling():
    """Bank exports often omit ö in Göteborg."""
    assert is_el_expense("Autogiro Goteborg Energi Din El")
    assert categorize("Autogiro Goteborg Energi Din El", "Utgift", -100) == "Boende (el)"


def test_partille_energi_is_el():
    assert categorize("Autogiro Partille Energi", "Utgift", -200) == "Boende (el)"


def test_geab_is_el():
    assert categorize("Autogiro GEAB", "Utgift", -300) == "Boende (el)"


def test_lysa_spar_still_transfer():
    row = {
        "amount": -2000.0,
        "description": "Autogiro Lysa Spar",
        "account": "Patriks Lönekonto",
    }
    enriched = enrich_transaction(row, own_accounts_regex="")
    assert enriched["typ"] == "Överföring"
    assert enriched["category"] == "Överföring"
