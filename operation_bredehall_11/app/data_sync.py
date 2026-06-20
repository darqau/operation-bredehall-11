"""Sync git-tracked data from the image bundle (/app/data) into HA runtime (/data).

Local development uses operation_bredehall_11/data/ directly — no copy step.
In the add-on container, /data is a persistent volume; when the bundled files
from git differ (hash), the bundle wins so git remains the single source of truth.
"""
from __future__ import annotations

import hashlib
import logging
import shutil
from pathlib import Path

logger = logging.getLogger(__name__)

RUNTIME_DATA = Path("/data")
BUNDLED_DATA = Path(__file__).resolve().parent.parent / "data"

SYNC_FILES = ("bredehall.db", "finance_config.json")


def _file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def sync_bundled_data(
    *,
    bundled_dir: Path | None = None,
    runtime_dir: Path | None = None,
) -> list[str]:
    """Copy bundled DB/config into runtime when content differs. Returns synced names."""
    bundled = bundled_dir or BUNDLED_DATA
    runtime = runtime_dir or RUNTIME_DATA

    if not bundled.is_dir():
        return []
    if bundled.resolve() == runtime.resolve():
        return []
    if runtime.exists() and not runtime.is_dir():
        return []

    synced: list[str] = []
    runtime.mkdir(parents=True, exist_ok=True)

    for name in SYNC_FILES:
        src = bundled / name
        dst = runtime / name
        if not src.is_file():
            continue
        if dst.is_file() and _file_hash(src) == _file_hash(dst):
            continue
        shutil.copy2(src, dst)
        synced.append(name)
        logger.info("Synced %s from git bundle → %s", name, dst)

    return synced
