"""Pytest configuration."""
import os
import tempfile
from pathlib import Path

import pytest

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="bredehall_test_"))
os.environ.pop("APP_API_KEY", None)
os.environ.pop("ALLOW_WIPE", None)

from app.database import DATA_DIR, init_db, engine  # noqa: E402
from app.migrations import run_migrations  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def setup_db():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    init_db()
    run_migrations(engine)
    yield
