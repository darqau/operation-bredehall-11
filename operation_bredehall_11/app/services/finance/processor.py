"""Import bank CSV files from local folders or Google Drive."""
from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any, Dict, List, Tuple

from sqlalchemy.orm import Session

from app.crud_finance import apply_learned_category, create_transactions_bulk, get_learned_categories
from app.services.finance.categorizer import enrich_transaction
from app.services.finance.config import (
    FINANCE_ARCHIVE,
    get_finance_config,
    local_inbox_for_account,
)
from app.services.finance.csv_parser import parse_bank_csv
from app.services.finance.gdrive import fetch_account_csvs


def _read_csv_text(path: Path) -> str:
    raw = path.read_bytes()
    for enc in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("latin-1", errors="replace")


def _rows_from_csv(content: str, account: str, filename: str, config: Dict[str, Any], learned: dict | None = None) -> List[dict]:
    own_regex = config.get("own_accounts_regex") or ""
    delimiter = config.get("csv_delimiter") or ";"
    rows = []
    learned = learned or {}
    for parsed in parse_bank_csv(content, delimiter=delimiter):
        row = {
            **parsed,
            "account": account,
            "source_file": filename,
            "is_manual": False,
        }
        apply_learned_category(row, learned)
        enrich_transaction(row, own_regex)
        rows.append(row)
    return rows


def _archive_target(path: Path, account: str) -> Path:
    dest = FINANCE_ARCHIVE / account
    dest.mkdir(parents=True, exist_ok=True)
    target = dest / path.name
    if not target.exists():
        return target
    stem = path.stem
    suffix = path.suffix
    n = 1
    while target.exists():
        target = dest / f"{stem}_{n}{suffix}"
        n += 1
    return target


def process_local_folders(db: Session, config: Dict[str, Any]) -> Dict[str, Any]:
    folder_map = config.get("folder_map") or {}
    all_rows: List[dict] = []
    pending_moves: List[Tuple[str, str, Path, Path]] = []
    processed: List[str] = []
    errors: List[str] = []

    learned = get_learned_categories(db)
    for account in folder_map:
        inbox = local_inbox_for_account(account)
        for path in sorted(inbox.glob("*.csv")):
            try:
                content = _read_csv_text(path)
                rows = _rows_from_csv(content, account, path.name, config, learned)
                if rows:
                    all_rows.extend(rows)
                    pending_moves.append((account, path.name, path, _archive_target(path, account)))
            except Exception as e:
                errors.append(f"{account}/{path.name}: {e}")

    bulk = {"added": 0, "skipped": 0}
    if all_rows:
        try:
            bulk = create_transactions_bulk(db, all_rows)
            for account, filename, src, dst in pending_moves:
                shutil.move(str(src), str(dst))
                processed.append(f"{account}/{filename}")
        except Exception as e:
            errors.append(f"DB-import misslyckades, filer lämnades i inbox: {e}")
            return {
                "ok": False,
                "mode": "local",
                "files_processed": 0,
                "transactions_added": 0,
                "transactions_skipped": 0,
                "processed": [],
                "errors": errors,
            }

    return {
        "ok": True,
        "mode": "local",
        "files_processed": len(processed),
        "transactions_added": bulk["added"],
        "transactions_skipped": bulk["skipped"],
        "processed": processed,
        "errors": errors,
    }


def process_gdrive(db: Session, config: Dict[str, Any]) -> Dict[str, Any]:
    items, processed, errors = fetch_account_csvs(config)
    learned = get_learned_categories(db)
    all_rows: List[dict] = []
    for item in items:
        try:
            rows = _rows_from_csv(item["content"], item["account"], item["filename"], config, learned)
            all_rows.extend(rows)
        except Exception as e:
            errors.append(f"{item['account']}/{item['filename']}: {e}")

    bulk = create_transactions_bulk(db, all_rows) if all_rows else {"added": 0, "skipped": 0}
    return {
        "ok": True,
        "mode": "gdrive",
        "files_processed": len(processed),
        "transactions_added": bulk["added"],
        "transactions_skipped": bulk["skipped"],
        "processed": processed,
        "errors": errors,
    }


def process_bank_files(db: Session) -> Dict[str, Any]:
    config = get_finance_config()
    mode = (config.get("storage_mode") or "local").lower()
    if mode == "gdrive":
        result = process_gdrive(db, config)
    else:
        result = process_local_folders(db, config)

    if result.get("transactions_added"):
        from app.crud_finance import detect_internal_transfers
        from app.services.finance.config import get_finance_config

        cfg = get_finance_config()
        result["internal_transfers"] = detect_internal_transfers(
            db, own_accounts_regex=cfg.get("own_accounts_regex") or ""
        )
    return result


def add_manual_entry(db: Session, entry: dict, config: Dict[str, Any] | None = None) -> dict:
    cfg = config or get_finance_config()
    own_regex = cfg.get("own_accounts_regex") or ""
    learned = get_learned_categories(db)
    row = {
        "txn_date": entry["txn_date"],
        "amount": float(entry["amount"]),
        "description": entry.get("description") or "",
        "balance": entry.get("balance"),
        "account": entry["account"],
        "currency": entry.get("currency") or "SEK",
        "sender": None,
        "receiver": None,
        "source_file": None,
        "is_manual": True,
        "manual_category": entry.get("category"),
    }
    apply_learned_category(row, learned)
    enrich_transaction(row, own_regex)
    from app.crud_finance import create_transaction

    txn = create_transaction(db, row)
    return {"id": txn.id}
