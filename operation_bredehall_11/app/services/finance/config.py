"""Finance configuration: local folders or Google Drive folder map."""
from __future__ import annotations

import json
import os
from copy import deepcopy
from pathlib import Path
from typing import Any, Dict, Optional

from app.database import DATA_DIR

# Example placeholders — fill in real values via Settings UI or finance_config.json.
EXAMPLE_FOLDER_MAP: Dict[str, str] = {
    "Gemensamt konto": "",
    "Lönekonto": "",
    "Sparkonto": "",
}

EXAMPLE_ACCOUNT_NUMBERS: Dict[str, str] = {
    "Gemensamt konto": "1234 56 78901",
    "Lönekonto": "9876543210",
    "Sparkonto": "1234 56 78999",
}

DEFAULT_CONFIG: Dict[str, Any] = {
    "storage_mode": "local",
    "folder_map": dict(EXAMPLE_FOLDER_MAP),
    "account_numbers": dict(EXAMPLE_ACCOUNT_NUMBERS),
    "archive_folder_id": "",
    "gdrive_credentials_path": "",
    "own_accounts_regex": r"Personkonto|Sparkonto|Lönekonto",
    "csv_delimiter": ";",
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


def _read_ha_options() -> Dict[str, Any]:
    for path in ("/data/options.json", "/config/options.json"):
        p = Path(path)
        if not p.is_file():
            continue
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
    return {}


def sync_ha_options() -> None:
    """Apply Home Assistant add-on options to finance_config.json when unset."""
    opts = _read_ha_options()
    if not opts:
        return
    cfg = get_finance_config()
    changed = False
    mode = (opts.get("finance_storage_mode") or "").strip()
    if mode and not CONFIG_PATH.exists():
        cfg["storage_mode"] = mode
        changed = True
    if changed:
        save_finance_config(cfg)


def migrate_legacy_config(cfg: Dict[str, Any]) -> Dict[str, Any]:
    """One-time renames / fixes for stored finance config."""
    folder_map = dict(cfg.get("folder_map") or {})
    if "Linneas Lönekonto" in folder_map and "Patriks Lönekonto" not in folder_map:
        folder_map["Patriks Lönekonto"] = folder_map.pop("Linneas Lönekonto")
    cfg["folder_map"] = folder_map

    account_numbers = dict(cfg.get("account_numbers") or {})
    if "Linneas Lönekonto" in account_numbers:
        if "Patriks Lönekonto" not in account_numbers:
            account_numbers["Patriks Lönekonto"] = account_numbers.pop("Linneas Lönekonto")
        else:
            account_numbers.pop("Linneas Lönekonto", None)
    cfg["account_numbers"] = account_numbers
    return cfg


def merge_default_folders(folder_map: Dict[str, str]) -> Dict[str, str]:
    """Add missing example account names without overwriting user Drive IDs."""
    merged = dict(folder_map)
    for name in EXAMPLE_FOLDER_MAP:
        if name not in merged:
            merged[name] = EXAMPLE_FOLDER_MAP[name]
    return merged


def merge_default_account_numbers(account_numbers: Dict[str, str]) -> Dict[str, str]:
    merged = dict(account_numbers)
    for name, default in EXAMPLE_ACCOUNT_NUMBERS.items():
        if name not in merged:
            merged[name] = default
    return merged


def account_number_for(name: str, config: Optional[Dict[str, Any]] = None) -> str:
    cfg = config or get_finance_config()
    return (cfg.get("account_numbers") or {}).get(name, "").strip()


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
            merged = migrate_legacy_config(merged)
            if "folder_map" in stored:
                merged["folder_map"] = merge_default_folders(stored["folder_map"])
            else:
                merged["folder_map"] = merge_default_folders(dict(EXAMPLE_FOLDER_MAP))
            if "account_numbers" in stored:
                merged["account_numbers"] = merge_default_account_numbers(stored["account_numbers"])
            else:
                merged["account_numbers"] = merge_default_account_numbers(dict(EXAMPLE_ACCOUNT_NUMBERS))
            ensure_all_inbox_folders(merged["folder_map"])
            return merged
        except (json.JSONDecodeError, OSError):
            pass
    cfg = deepcopy(DEFAULT_CONFIG)
    cfg["folder_map"] = merge_default_folders(dict(EXAMPLE_FOLDER_MAP))
    save_finance_config(cfg)
    return cfg


def save_finance_config(config: Dict[str, Any]) -> Dict[str, Any]:
    _ensure_dirs()
    merged = deepcopy(DEFAULT_CONFIG)
    merged.update(config)
    if "folder_map" in config:
        merged["folder_map"] = merge_default_folders(config["folder_map"])
    if "account_numbers" in config:
        merged["account_numbers"] = merge_default_account_numbers(config["account_numbers"])
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
