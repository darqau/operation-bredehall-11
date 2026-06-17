"""Finance configuration: local folders or Google Drive folder map."""
from __future__ import annotations

import json
import os
from copy import deepcopy
from pathlib import Path
from typing import Any, Dict

from app.database import DATA_DIR

DEFAULT_FOLDER_MAP = {
    "Gemensamt Nordea": "1U5W4QE7Bgk432FCoOBfWDKCQP7su1wuH",
    "Lönekonto Nordea": "1r-ADjFekM97OzU9JM8Pr5tCx71BNBZe7",
    "Lönekonto Swedbank": "19zsxBWloi-CgzL1nqO6OIk8WqWiYsU1O",
    "Linneas CSN": "1soHvN6meUV6kuhAv-nesnp9rxgvmVK_q",
    "Linneas Lönekonto": "1crlVTbYoZGn4zL44pNKz_Ghe2Y82kopL",
    "Linneas Sparkonto": "1TIfPJkeyE386Q6yvsbo_GlLHASJGx0IT",
    "Patriks Sparkonto": "",
    "Räkningar Swedbank": "",
}

DEFAULT_CONFIG: Dict[str, Any] = {
    "storage_mode": "local",
    "folder_map": DEFAULT_FOLDER_MAP,
    "archive_folder_id": "1NR3ch3fIpfNDVfwGOhNs30OgYsWGLsZa",
    "gdrive_credentials_path": "",
    "own_accounts_regex": r"1936|920117|3300|1127|3055|3100|Personkonto",
    "csv_delimiter": ";",
    # Optional AI categorizer (LM Studio / OpenAI-compatible). Off by default.
    "ai_enabled": False,
    "ai_base_url": "http://localhost:1234/v1",
    "ai_api_key": "lm-studio",
    "ai_model": "local-model",
}

CONFIG_PATH = DATA_DIR / "finance_config.json"
FINANCE_INBOX = DATA_DIR / "finance" / "inbox"
FINANCE_ARCHIVE = DATA_DIR / "finance" / "archive"


def _ensure_dirs() -> None:
    FINANCE_INBOX.mkdir(parents=True, exist_ok=True)
    FINANCE_ARCHIVE.mkdir(parents=True, exist_ok=True)


def merge_default_folders(folder_map: Dict[str, str]) -> Dict[str, str]:
    """Add missing default accounts without overwriting existing Drive IDs."""
    merged = dict(folder_map)
    for name, default_id in DEFAULT_FOLDER_MAP.items():
        if name not in merged:
            merged[name] = default_id
        elif not merged[name] and default_id:
            merged[name] = default_id
    return merged


def ensure_all_inbox_folders(folder_map: Dict[str, str]) -> None:
    _ensure_dirs()
    for account in folder_map:
        (FINANCE_INBOX / account).mkdir(parents=True, exist_ok=True)


def get_finance_config() -> Dict[str, Any]:
    _ensure_dirs()
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH, encoding="utf-8") as f:
                stored = json.load(f)
            merged = deepcopy(DEFAULT_CONFIG)
            merged.update(stored)
            if "folder_map" in stored:
                merged["folder_map"] = merge_default_folders(stored["folder_map"])
            else:
                merged["folder_map"] = merge_default_folders(DEFAULT_FOLDER_MAP)
            ensure_all_inbox_folders(merged["folder_map"])
            return merged
        except (json.JSONDecodeError, OSError):
            pass
    cfg = deepcopy(DEFAULT_CONFIG)
    cfg["folder_map"] = merge_default_folders(DEFAULT_FOLDER_MAP)
    save_finance_config(cfg)
    return cfg


def save_finance_config(config: Dict[str, Any]) -> Dict[str, Any]:
    _ensure_dirs()
    merged = deepcopy(DEFAULT_CONFIG)
    merged.update(config)
    if "folder_map" in config:
        merged["folder_map"] = merge_default_folders(config["folder_map"])
    ensure_all_inbox_folders(merged["folder_map"])
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(merged, f, ensure_ascii=False, indent=2)
    return merged


def local_inbox_for_account(account: str) -> Path:
    path = FINANCE_INBOX / account
    path.mkdir(parents=True, exist_ok=True)
    return path


def resolve_gdrive_credentials_path(config: Dict[str, Any]) -> Path | None:
    raw = (config.get("gdrive_credentials_path") or "").strip()
    if not raw:
        env = os.environ.get("GDRIVE_CREDENTIALS_PATH", "").strip()
        if env:
            raw = env
    if not raw:
        for candidate in (
            DATA_DIR / "gdrive_credentials.json",
            Path("/config/gdrive_credentials.json"),
            Path("/data/gdrive_credentials.json"),
        ):
            if candidate.is_file():
                return candidate
        return None
    path = Path(raw)
    return path if path.is_file() else None
