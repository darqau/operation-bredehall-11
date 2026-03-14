"""Export av deadlines till iCal (.ics) – importera sedan i Google Calendar."""
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from app.crud import get_tasks
from app.database import get_db

router = APIRouter(prefix="/api/calendar", tags=["calendar"])


def _ics_escape(s: str) -> str:
    return (s or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


@router.get("/ical", response_class=PlainTextResponse)
def export_ical(db: Session = Depends(get_db)):
    """Exportera alla uppgifter med deadline som iCal (.ics). Öppna filen eller importera i Google Calendar."""
    tasks = get_tasks(db, view=None, year=None)
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Operation Bredehall 11//Underhållsplanerare//SV",
        "CALSCALE:GREGORIAN",
    ]
    for t in tasks:
        if not t.next_deadline:
            continue
        # En dag som helgdag (hela dagen)
        d = t.next_deadline
        dt_start = datetime(d.year, d.month, d.day, 0, 0, 0)
        dt_end = datetime(d.year, d.month, d.day, 23, 59, 59)
        uid = f"bredehall-{t.id}-{d.isoformat()}@local"
        summary = _ics_escape(t.title)
        desc = _ics_escape((t.reason or "") + ("\n" + (t.description or "") if t.description else ""))
        block = [
            "BEGIN:VEVENT",
            f"UID:{uid}",
            f"DTSTAMP:{datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')}",
            f"DTSTART;VALUE=DATE:{d.strftime('%Y%m%d')}",
            f"DTEND;VALUE=DATE:{(d + timedelta(days=1)).strftime('%Y%m%d')}",
            f"SUMMARY:{summary}",
        ]
        if desc:
            block.append(f"DESCRIPTION:{desc}")
        block.append("END:VEVENT")
        lines.extend(block)
    lines.append("END:VCALENDAR")
    body = "\r\n".join(l for l in lines if l)
    return PlainTextResponse(body, media_type="text/calendar; charset=utf-8", headers={
        "Content-Disposition": "attachment; filename=bredehall_deadlines.ics",
    })
