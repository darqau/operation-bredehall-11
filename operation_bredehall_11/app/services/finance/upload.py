"""Save uploaded CSV files to account inbox folders."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Optional

from app.services.finance.config import get_finance_config, local_inbox_for_account, save_finance_config


def _safe_filename(name: str) -> str:
    base = Path(name).name
    base = re.sub(r'[<>:"/\\|?*]', "_", base).strip()
    return base or "upload.csv"


def unique_path(folder: Path, filename: str) -> Path:
    target = folder / filename
    if not target.exists():
        return target
    stem = Path(filename).stem
    suffix = Path(filename).suffix or ".csv"
    n = 1
    while True:
        candidate = folder / f"{stem}_{n}{suffix}"
        if not candidate.exists():
            return candidate
        n += 1


def save_upload_to_inbox(account: str, filename: str, content: bytes) -> dict:
    cfg = get_finance_config()
    folder_map = cfg.get("folder_map") or {}
    if account not in folder_map:
        folder_map[account] = ""
        cfg["folder_map"] = folder_map
        save_finance_config(cfg)

    inbox = local_inbox_for_account(account)
    safe = _safe_filename(filename)
    if not safe.lower().endswith(".csv"):
        safe += ".csv"
    dest = unique_path(inbox, safe)
    dest.write_bytes(content)
    return {
        "account": account,
        "filename": dest.name,
        "path": str(dest),
    }


def create_account_folder(name: str, drive_folder_id: str = "") -> dict:
    name = name.strip()
    if not name:
        raise ValueError("Kontonamn saknas")
    cfg = get_finance_config()
    folder_map = cfg.get("folder_map") or {}
    if name in folder_map:
        local_inbox_for_account(name)
        return {"account": name, "created": False, "folder_map": folder_map}
    folder_map[name] = drive_folder_id
    cfg["folder_map"] = folder_map
    save_finance_config(cfg)
    local_inbox_for_account(name)
    return {"account": name, "created": True, "folder_map": folder_map}
