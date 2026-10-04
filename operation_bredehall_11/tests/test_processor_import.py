"""Regression: process_bank_files must not shadow get_finance_config."""
from unittest.mock import patch

from app.services.finance.processor import process_bank_files


def test_process_bank_files_after_transactions_added(setup_db):
    cfg = {
        "storage_mode": "local",
        "folder_map": {"Testkonto": ""},
        "own_accounts_regex": "",
        "csv_delimiter": ";",
    }
    with patch("app.services.finance.processor.get_finance_config", return_value=cfg):
        with patch("app.services.finance.processor.process_local_folders") as mock_local:
            mock_local.return_value = {
                "ok": True,
                "mode": "local",
                "files_processed": 1,
                "transactions_added": 2,
                "transactions_skipped": 0,
                "processed": ["Testkonto/a.csv"],
                "errors": [],
                "by_account": [{"account": "Testkonto", "added": 2, "skipped": 0, "files": ["a.csv"]}],
                "unknown_files": [],
                "rerouted": [],
            }
            with patch("app.crud_finance.detect_internal_transfers", return_value=1) as mock_detect:
                result = process_bank_files(setup_db)
    assert result["transactions_added"] == 2
    assert result["internal_transfers"] == 1
    mock_detect.assert_called_once()
