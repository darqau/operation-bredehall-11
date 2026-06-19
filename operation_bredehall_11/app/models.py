"""
Databasmodell för underhållsuppgifter.
SQLite-tabellstruktur för Operation Bredehall 11.
"""
from datetime import date, datetime
from typing import Optional

from sqlalchemy import String, Text, Date, DateTime, Integer, Float, Boolean, Index, ForeignKey
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


class TaskCompletion(Base):
    """Logg över avslutade uppgifter: vem som utförde och när."""
    __tablename__ = "task_completions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True, index=True
    )
    task_title: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    category: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    completed_by: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    completed_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_completion_when", "completed_at"),
    )

    def __repr__(self) -> str:
        return f"<TaskCompletion(task={self.task_title!r}, by={self.completed_by})>"


class FinanceTransaction(Base):
    """Bank- och manuella transaktioner (ersätter RAW_DATA + MANUAL_DATA + ALL_DATA)."""
    __tablename__ = "finance_transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    txn_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    balance: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    account: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    typ: Mapped[str] = mapped_column(String(32), nullable=False, default="Övrigt")
    category: Mapped[str] = mapped_column(String(64), nullable=False, default="Övrigt")
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="SEK")
    sender: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    receiver: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    source_file: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    is_manual: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    category_locked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    amount_ore: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    __table_args__ = (
        Index("ix_finance_account_date", "account", "txn_date"),
    )


class FinanceLoan(Base):
    """Manuellt underhållna lån/skulder (t.ex. bolån från bank-app)."""
    __tablename__ = "finance_loans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    label: Mapped[str] = mapped_column(String(255), nullable=False, default="Bolån")
    account_number: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    amount_ore: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    typ: Mapped[str] = mapped_column(String(64), nullable=False, default="bolån")
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    def __repr__(self) -> str:
        return f"<FinanceLoan(id={self.id}, account={self.account_number!r}, amount={self.amount})>"
