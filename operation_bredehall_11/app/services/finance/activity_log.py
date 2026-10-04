"""Persist and query finance import / account activity."""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.models import FinanceActivityLog


def log_finance_activity(
    db: Session,
    *,
    event_type: str,
    summary: str,
    account: Optional[str] = None,
    filename: Optional[str] = None,
    transaction_count: int = 0,
    skipped_count: int = 0,
    details: Optional[dict[str, Any]] = None,
) -> FinanceActivityLog:
    entry = FinanceActivityLog(
        created_at=datetime.now(),
        event_type=event_type,
        account=account,
        filename=filename,
        transaction_count=transaction_count,
        skipped_count=skipped_count,
        summary=summary,
        details=json.dumps(details, ensure_ascii=False) if details else None,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


def list_activity_log(
    db: Session,
    *,
    limit: int = 100,
    offset: int = 0,
    event_type: Optional[str] = None,
) -> tuple[list[FinanceActivityLog], int]:
    q = db.query(FinanceActivityLog)
    if event_type:
        q = q.filter(FinanceActivityLog.event_type == event_type)
    q = q.order_by(FinanceActivityLog.created_at.desc(), FinanceActivityLog.id.desc())
    total = q.count()
    rows = q.offset(offset).limit(limit).all()
    return rows, total


def parse_activity_details(raw: Optional[str]) -> Optional[Any]:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
