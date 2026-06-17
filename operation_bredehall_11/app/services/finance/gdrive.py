"""Google Drive import (optional – requires credentials JSON)."""
from __future__ import annotations

import io
from pathlib import Path
from typing import Any, Dict, List, Tuple

from app.services.finance.config import resolve_gdrive_credentials_path


def _get_drive_service(credentials_path: Path):
    from google.oauth2 import service_account
    from googleapiclient.discovery import build

    scopes = ["https://www.googleapis.com/auth/drive"]
    creds = service_account.Credentials.from_service_account_file(
        str(credentials_path), scopes=scopes
    )
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def list_csv_files_in_folder(service, folder_id: str) -> List[Dict[str, str]]:
    query = f"'{folder_id}' in parents and trashed=false"
    results = (
        service.files()
        .list(q=query, fields="files(id,name,mimeType)", pageSize=200)
        .execute()
    )
    files = []
    for f in results.get("files", []):
        name = f.get("name", "")
        mime = f.get("mimeType", "")
        if mime == "text/csv" or name.lower().endswith(".csv"):
            files.append({"id": f["id"], "name": name})
    return files


def download_file_content(service, file_id: str) -> str:
    from googleapiclient.http import MediaIoBaseDownload

    request = service.files().get_media(fileId=file_id)
    buf = io.BytesIO()
    downloader = MediaIoBaseDownload(buf, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    return buf.getvalue().decode("utf-8-sig", errors="replace")


def move_file_to_folder(service, file_id: str, archive_folder_id: str) -> None:
    file_meta = service.files().get(fileId=file_id, fields="parents").execute()
    prev_parents = ",".join(file_meta.get("parents", []))
    service.files().update(
        fileId=file_id,
        addParents=archive_folder_id,
        removeParents=prev_parents,
        fields="id, parents",
    ).execute()


def fetch_account_csvs(
    config: Dict[str, Any],
) -> Tuple[List[Dict[str, Any]], List[str], List[str]]:
    """
    Download CSV files from configured Drive folders.
    Returns (items with account+filename+content, processed_files, errors).
    """
    cred_path = resolve_gdrive_credentials_path(config)
    if not cred_path:
        return [], [], ["Google Drive-credentials saknas. Lägg gdrive_credentials.json i data/ eller ange sökväg i inställningar."]

    try:
        service = _get_drive_service(cred_path)
    except Exception as e:
        return [], [], [f"Kunde inte autentisera mot Google Drive: {e}"]

    folder_map = config.get("folder_map") or {}
    archive_id = (config.get("archive_folder_id") or "").strip()
    items: List[Dict[str, Any]] = []
    processed: List[str] = []
    errors: List[str] = []

    for account, folder_id in folder_map.items():
        if not folder_id:
            continue
        try:
            csv_files = list_csv_files_in_folder(service, folder_id)
            for cf in csv_files:
                content = download_file_content(service, cf["id"])
                items.append(
                    {
                        "account": account,
                        "filename": cf["name"],
                        "content": content,
                        "file_id": cf["id"],
                    }
                )
                if archive_id:
                    try:
                        move_file_to_folder(service, cf["id"], archive_id)
                    except Exception as move_err:
                        errors.append(f"Arkiverade inte {cf['name']}: {move_err}")
                processed.append(f"{account}/{cf['name']}")
        except Exception as e:
            errors.append(f"Kunde inte läsa mapp {account}: {e}")

    return items, processed, errors
