"""Parse Swedish bank CSV exports (Nordea semicolon, Swedbank comma, etc.)."""
from __future__ import annotations

import csv
import io
import re
from datetime import date, datetime
from typing import Any, Dict, List, Optional


def parse_swedish_amount(value: Any) -> Optional[float]:
    if value is None:
        return None
    text = str(value).strip().replace("\ufeff", "")
    if not text:
        return None
    text = text.replace(" ", "").replace("\xa0", "")
    text = re.sub(r"[^0-9,.-]", "", text)
    if not text or text in ("-", "."):
        return None
    if "," in text and "." in text:
        text = text.replace(".", "").replace(",", ".")
    else:
        text = text.replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return None


def parse_swedish_date(value: Any) -> Optional[date]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip().replace("\ufeff", "")
    if not text or text.lower() in ("bokföringsdag", "datum", "bokföringsdag"):
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(text[:10], fmt).date()
        except ValueError:
            continue
    try:
        serial = float(text)
        if 30000 < serial < 60000:
            base = date(1899, 12, 30)
            return base.fromordinal(base.toordinal() + int(serial))
    except ValueError:
        pass
    return None


def _normalize_header(cell: str) -> str:
    return cell.strip().lower().replace("\ufeff", "").replace("ö", "o").replace("ä", "a").replace("å", "a")


def _detect_delimiter(content: str) -> str:
    for line in content.splitlines()[:8]:
        low = line.lower()
        if "bokföringsdag" in low or "bokföringsdag" in _normalize_header(line) or "radnummer" in low:
            return ";" if line.count(";") >= line.count(",") else ","
    return ";" if content.count(";") > content.count(",") else ","


def _find_header_row(rows: List[List[str]]) -> int:
    for i, row in enumerate(rows[:10]):
        h = [_normalize_header(c) for c in row]
        if "bokforingsdag" in h or "bokföringsdag" in [_normalize_header(c) for c in row]:
            return i
        if "radnummer" in h and "belopp" in h:
            return i
    return 0


def parse_bank_csv(content: str, delimiter: str | None = None) -> List[Dict[str, Any]]:
    """Return parsed rows from a bank CSV file."""
    content = content.lstrip("\ufeff")
    # Strip Swedbank comment header lines (* Transaktioner ...)
    lines = []
    for line in content.splitlines():
        if line.strip().startswith("*"):
            continue
        lines.append(line)
    content = "\n".join(lines)

    delim = delimiter or _detect_delimiter(content)
    reader = csv.reader(io.StringIO(content), delimiter=delim)
    rows = list(reader)
    if not rows:
        return []

    header_idx = _find_header_row(rows)
    headers = [_normalize_header(c) for c in rows[header_idx]]

    def col(name: str, aliases: tuple[str, ...] = ()) -> int:
        names = (name,) + aliases
        for n in names:
            n_norm = _normalize_header(n)
            if n_norm in headers:
                return headers.index(n_norm)
        return -1

    idx_date = col("bokföringsdag", ("bokforingsdag", "datum", "transaktionsdag"))
    idx_amount = col("belopp")
    idx_sender = col("avsändare", ("avsandare",))
    idx_receiver = col("mottagare")
    idx_desc = col("beskrivning", ("rubrik", "referens"))
    idx_balance = col("saldo", ("bokfört saldo", "bokfort saldo", "bokfört saldo"))
    idx_currency = col("valuta")

    parsed: List[Dict[str, Any]] = []
    for row in rows[header_idx + 1 :]:
        if not row or not any(str(c).strip() for c in row):
            continue
        first = str(row[0]).strip().lower()
        if first in ("bokföringsdag", "bokforingsdag", "datum", "reserverat", "radnummer"):
            continue

        def get(i: int) -> Optional[str]:
            if i < 0 or i >= len(row):
                return None
            val = str(row[i]).strip()
            return val or None

        txn_date = parse_swedish_date(row[idx_date] if idx_date >= 0 else None)
        amount = parse_swedish_amount(row[idx_amount] if idx_amount >= 0 else None)
        if txn_date is None or amount is None:
            continue

        desc = get(idx_desc) or ""
        if not desc and idx_desc >= 0:
            desc = get(col("referens")) or ""

        parsed.append(
            {
                "txn_date": txn_date,
                "amount": amount,
                "sender": get(idx_sender),
                "receiver": get(idx_receiver),
                "description": desc,
                "balance": parse_swedish_amount(row[idx_balance] if idx_balance >= 0 else None),
                "currency": get(idx_currency) or "SEK",
            }
        )
    return parsed
