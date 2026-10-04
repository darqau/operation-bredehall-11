"""Import bank CSV files from local folders or Google Drive."""
from __future__ import annotations

import shutil
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from sqlalchemy.orm import Session

from app.crud_finance import (
    apply_learned_category,
    create_transactions_bulk,
    get_learned_categories,
    infer_account_from_fields,
)
from app.services.finance.activity_log import log_finance_activity
from app.services.finance.categorizer import enrich_transaction
from app.services.finance.config import (
    FINANCE_ARCHIVE,
    get_finance_config,
    local_inbox_for_account,
)
from app.services.finance.csv_parser import parse_bank_csv
from app.services.finance.detect import detect_account
from app.services.finance.gdrive import fetch_account_csvs

_UNKNOWN_SCORE = 0.35


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
    numbers = {
        acc: (num or "").strip()
        for acc, num in (config.get("account_numbers") or {}).items()
        if (num or "").strip()
    }
    rows = []
    learned = learned or {}
    for parsed in parse_bank_csv(content, delimiter=delimiter):
        row = {
            **parsed,
            "account": account,
            "source_file": filename,
            "is_manual": False,
        }
        inferred = infer_account_from_fields(
            source_file=filename,
            sender=row.get("sender"),
            receiver=row.get("receiver"),
            numbers=numbers,
        )
        if inferred:
            row["account"] = inferred
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


def _resolve_file_account(
    filename: str,
    content: str,
    inbox_account: str,
    accounts: List[str],
    *,
    trusted: bool,
) -> Tuple[Optional[str], Dict[str, Any], bool]:
    """Return target account, detection payload, and whether file is unknown."""
    detection = detect_account(filename, content, accounts)
    if trusted:
        return inbox_account, detection, False

    if detection.get("auto_detected") and detection.get("detected_account"):
        return detection["detected_account"], detection, False

    candidates = detection.get("candidates") or []
    top_score = candidates[0]["score"] if candidates else 0.0
    if top_score < _UNKNOWN_SCORE:
        return None, detection, True

    return inbox_account, detection, False


def _merge_account_stats(
    stats: Dict[str, Dict[str, Any]],
    account: str,
    *,
    added: int,
    skipped: int,
    filename: str,
) -> None:
    bucket = stats.setdefault(account, {"added": 0, "skipped": 0, "files": []})
    bucket["added"] += added
    bucket["skipped"] += skipped
    if filename and filename not in bucket["files"]:
        bucket["files"].append(filename)


def _stats_to_list(stats: Dict[str, Dict[str, Any]]) -> List[dict]:
    return [
        {
            "account": account,
            "added": data["added"],
            "skipped": data["skipped"],
            "files": list(data["files"]),
        }
        for account, data in sorted(stats.items(), key=lambda x: x[0].casefold())
        if data["added"] or data["skipped"] or data["files"]
    ]


def process_local_folders(
    db: Session,
    config: Dict[str, Any],
    *,
    trusted_keys: Optional[Set[str]] = None,
) -> Dict[str, Any]:
    folder_map = config.get("folder_map") or {}
    accounts = list(folder_map.keys())
    trusted_keys = trusted_keys or set()
    processed: List[str] = []
    errors: List[str] = []
    unknown_files: List[dict] = []
    rerouted: List[dict] = []
    account_stats: Dict[str, Dict[str, Any]] = defaultdict(lambda: {"added": 0, "skipped": 0, "files": []})
    total_added = 0
    total_skipped = 0

    learned = get_learned_categories(db)

    for inbox_account in folder_map:
        inbox = local_inbox_for_account(inbox_account)
        for path in sorted(inbox.glob("*.csv")):
            key = f"{inbox_account}/{path.name}"
            trusted = key in trusted_keys
            try:
                content = _read_csv_text(path)
                target, detection, is_unknown = _resolve_file_account(
                    path.name, content, inbox_account, accounts, trusted=trusted
                )
                preview_rows = _rows_from_csv(content, inbox_account, path.name, config, learned)
                row_count = len(preview_rows)

                if is_unknown:
                    unknown_files.append(
                        {
                            "filename": path.name,
                            "inbox_account": inbox_account,
                            "row_count": row_count,
                            "detection": detection,
                        }
                    )
                    continue

                assert target is not None
                if target != inbox_account:
                    rerouted.append(
                        {
                            "filename": path.name,
                            "from_account": inbox_account,
                            "to_account": target,
                            "reason": "auto-detekterat konto",
                        }
                    )

                rows = _rows_from_csv(content, target, path.name, config, learned)
                if not rows:
                    continue

                bulk = create_transactions_bulk(db, rows)
                dst = _archive_target(path, target)
                shutil.move(str(path), str(dst))
                processed.append(f"{target}/{path.name}")

                _merge_account_stats(
                    account_stats,
                    target,
                    added=bulk["added"],
                    skipped=bulk["skipped"],
                    filename=path.name,
                )
                total_added += bulk["added"]
                total_skipped += bulk["skipped"]

                log_finance_activity(
                    db,
                    event_type="csv_import",
                    account=target,
                    filename=path.name,
                    transaction_count=bulk["added"],
                    skipped_count=bulk["skipped"],
                    summary=(
                        f"{bulk['added']} transaktioner importerade till {target} "
                        f"({path.name}, {bulk['skipped']} dubbletter hoppades över)"
                    ),
                    details={
                        "inbox_account": inbox_account,
                        "detected_account": detection.get("detected_account"),
                        "auto_detected": detection.get("auto_detected"),
                        "rerouted": target != inbox_account,
                    },
                )
            except Exception as e:
                errors.append(f"{inbox_account}/{path.name}: {e}")

    return {
        "ok": not errors or total_added > 0,
        "mode": "local",
        "files_processed": len(processed),
        "transactions_added": total_added,
        "transactions_skipped": total_skipped,
        "processed": processed,
        "errors": errors,
        "by_account": _stats_to_list(account_stats),
        "unknown_files": unknown_files,
        "rerouted": rerouted,
    }


def process_gdrive(db: Session, config: Dict[str, Any]) -> Dict[str, Any]:
    items, processed, errors = fetch_account_csvs(config)
    learned = get_learned_categories(db)
    account_stats: Dict[str, Dict[str, Any]] = defaultdict(lambda: {"added": 0, "skipped": 0, "files": []})
    total_added = 0
    total_skipped = 0

    for item in items:
        try:
            rows = _rows_from_csv(item["content"], item["account"], item["filename"], config, learned)
            if not rows:
                continue
            bulk = create_transactions_bulk(db, rows)
            total_added += bulk["added"]
            total_skipped += bulk["skipped"]
            _merge_account_stats(
                account_stats,
                item["account"],
                added=bulk["added"],
                skipped=bulk["skipped"],
                filename=item["filename"],
            )
            log_finance_activity(
                db,
                event_type="csv_import",
                account=item["account"],
                filename=item["filename"],
                transaction_count=bulk["added"],
                skipped_count=bulk["skipped"],
                summary=(
                    f"{bulk['added']} transaktioner importerade till {item['account']} "
                    f"({item['filename']}, {bulk['skipped']} dubbletter hoppades över)"
                ),
                details={"mode": "gdrive"},
            )
        except Exception as e:
            errors.append(f"{item['account']}/{item['filename']}: {e}")

    return {
        "ok": True,
        "mode": "gdrive",
        "files_processed": len(processed),
        "transactions_added": total_added,
        "transactions_skipped": total_skipped,
        "processed": processed,
        "errors": errors,
        "by_account": _stats_to_list(account_stats),
        "unknown_files": [],
        "rerouted": [],
    }


def process_bank_files(db: Session, *, trusted_keys: Optional[Set[str]] = None) -> Dict[str, Any]:
    config = get_finance_config()
    mode = (config.get("storage_mode") or "local").lower()
    if mode == "gdrive":
        result = process_gdrive(db, config)
    else:
        result = process_local_folders(db, config, trusted_keys=trusted_keys)

    if result.get("transactions_added"):
        from app.crud_finance import detect_internal_transfers

        result["internal_transfers"] = detect_internal_transfers(
            db, own_accounts_regex=config.get("own_accounts_regex") or ""
        )
    else:
        result.setdefault("internal_transfers", 0)

    if result.get("files_processed") or result.get("unknown_files"):
        if (result.get("files_processed", 0) > 1) or result.get("unknown_files"):
            log_finance_activity(
                db,
                event_type="batch_process",
                summary=(
                    f"Import klar: {result.get('transactions_added', 0)} nya transaktioner, "
                    f"{result.get('files_processed', 0)} filer"
                ),
                transaction_count=result.get("transactions_added", 0),
                skipped_count=result.get("transactions_skipped", 0),
                details={
                    "by_account": result.get("by_account"),
                    "unknown_files": result.get("unknown_files"),
                    "rerouted": result.get("rerouted"),
                },
            )
    return result
