from pathlib import Path
from unittest.mock import patch

from app.database import SessionLocal
from app.services.finance.config import FINANCE_INBOX, get_finance_config
from app.services.finance.processor import process_local_folders


def test_files_not_archived_on_db_failure(tmp_path):
    cfg = get_finance_config()
    account = "FailTest"
    cfg = dict(cfg)
    cfg["folder_map"] = {account: ""}
    inbox = FINANCE_INBOX / account
    inbox.mkdir(parents=True, exist_ok=True)
    csv_path = inbox / "test.csv"
    csv_path.write_text(
        "Bokföringsdag;Belopp;Text;Saldo\n2025-01-01;-10,00;Test;1000,00\n",
        encoding="utf-8",
    )

    db = SessionLocal()
    with patch("app.services.finance.processor.create_transactions_bulk", side_effect=RuntimeError("db fail")):
        result = process_local_folders(db, cfg)
    assert result["ok"] is False
    assert csv_path.exists()
    csv_path.unlink(missing_ok=True)
    db.close()
