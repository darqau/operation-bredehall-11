from unittest.mock import patch

from app.services.finance.detect import detect_account


CSN_CSV = """Bokföringsdag;Belopp;Avsändare;Mottagare;Namn;Rubrik;Saldo;Valuta;
2025/07/24;-460000,00;3100 22 43645;;;go3 8w9 5020 10 36983;269,19;SEK;
2025/07/24;-5000,00;3100 22 43645;;;Överföring 920117-1221;5000,00;SEK;
"""

ACCOUNTS = ["Gemensamt Nordea", "Linneas Lönekonto", "Linneas CSN", "Linneas Sparkonto"]
NUMBERS = {
    "Gemensamt Nordea": "1936 20 14939",
    "Linneas Lönekonto": "920117-1221",
    "Linneas CSN": "3100 22 43645",
    "Linneas Sparkonto": "3055 01 01268",
}


def test_detect_csn_file_not_lonekonto_despite_transfer_text():
    cfg = {"account_numbers": NUMBERS, "folder_map": {a: "" for a in ACCOUNTS}}
    with patch("app.services.finance.config.get_finance_config", return_value=cfg):
        result = detect_account("SPARKONTO 3100 22 43645.csv", CSN_CSV, ACCOUNTS)
    assert result["detected_account"] == "Linneas CSN"
    assert result["auto_detected"] is True


def test_detect_lonekonto_from_filename():
    cfg = {"account_numbers": NUMBERS, "folder_map": {a: "" for a in ACCOUNTS}}
    with patch("app.services.finance.config.get_finance_config", return_value=cfg):
        result = detect_account("PERSONKONTO 920117-1221.csv", CSN_CSV, ACCOUNTS)
    assert result["detected_account"] == "Linneas Lönekonto"
