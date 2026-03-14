"""
Databasmodell för underhållsuppgifter.
SQLite-tabellstruktur för Operation Bredehall 11.
"""
from datetime import date
from typing import Optional

from sqlalchemy import String, Text, Date, Integer
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
import enum


class TaskCategory(str, enum.Enum):
    """Kategori för uppgiften."""
    VVS = "VVS"
    TRADGARD = "Trädgård"
    EKONOMI = "Ekonomi"
    ADMINISTRATION = "Administration"
    HUS = "Hus"
    EL = "El"
    VARME = "Värme"
    ANNAT = "Annat"


class TaskFrequency(str, enum.Enum):
    """Frekvens för upprepning."""
    EN_GANG = "En gång"
    MANAD = "Månatlig"
    KVARTAL = "Kvartalsvis"
    HALVAR = "Varannan termin"
    ARLIG = "Årlig"
    VART_2_AR = "Vart 2:a år"
    VART_3_AR = "Vart 3:e år"
    VART_5_AR = "Vart 5:e år"
    VID_BEHOV = "Vid behov"


class Base(DeclarativeBase):
    """SQLAlchemy declarative base."""
    pass


class Task(Base):
    """
    Tabell: underhållsuppgifter.
    Fält enligt krav: titel, kategori, frekvens, senast utförd, nästa deadline,
    motivering, beskrivning/tips.
    """
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[str] = mapped_column(String(64), nullable=False)  # TaskCategory.value
    frequency: Mapped[str] = mapped_column(String(64), nullable=False)  # TaskFrequency.value
    last_done: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    next_deadline: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)   # Varför det ska göras (Motivering)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # Beskrivning och tips
    created_at: Mapped[Optional[date]] = mapped_column(Date, nullable=True)  # När posten skapades
    updated_at: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    def __repr__(self) -> str:
        return f"<Task(id={self.id}, title={self.title!r}, category={self.category})>"
