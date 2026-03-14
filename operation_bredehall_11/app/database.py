"""
SQLite-setup för Operation Bredehall 11.
Skapar engine, session och initierar tabeller.
Databasfil placeras i /data så att den persisterar mellan omstarter (HA add-on).
"""
import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

from app.models import Base

# Home Assistant add-on: /data är persistent volym; annars lokal fil
DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))
if not DATA_DIR.exists():
    DATA_DIR = Path(__file__).resolve().parent.parent / "data"
    DATA_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = DATA_DIR / "bredehall.db"
DATABASE_URL = f"sqlite:///{DB_PATH}"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    echo=False,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def init_db() -> None:
    """Skapar alla tabeller om de inte finns."""
    Base.metadata.create_all(bind=engine)


def get_db() -> Session:
    """Yield en DB-session för FastAPI dependency."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
