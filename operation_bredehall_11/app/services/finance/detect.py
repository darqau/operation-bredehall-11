"""Guess which account folder a bank CSV belongs to."""
from __future__ import annotations

import re
from collections import Counter
from typing import Any, Dict, List, Optional, Tuple

from app.services.finance.csv_parser import parse_bank_csv

ACCOUNT_HINTS: Dict[str, List[str]] = {
    "Gemensamt konto": [r"gemensamt", r"personkonto"],
    "Lönekonto": [r"lönekonto", r"lön"],
    "Sparkonto": [r"sparkonto", r"spar"],
}

BANK_HINTS = {
    "nordea": "nordea",
    "swedbank": "swedbank",
    "csn": "csn",
}

AUTO_THRESHOLD = 0.55
AUTO_MIN_GAP = 0.12


def _norm(text: str) -> str:
    return (text or "").lower().replace("ä", "a").replace("å", "a").replace("ö", "o")


def _number_pattern(num: str) -> str:
    return re.escape(num.strip()).replace(r"\ ", r"\s*")


def number_in_text(num: str, text: str) -> bool:
    num = (num or "").strip()
    if not num or len(num) < 4 or not text:
        return False
    return bool(re.search(_number_pattern(num), text, re.IGNORECASE))


def primary_spark_number_in_filename(filename: str) -> Optional[str]:
    """Extract 3100 22 XXXXX from Nordea SPARKONTO export filenames."""
    m = re.search(r"3100\s*22\s*(\d{5})", filename or "", re.IGNORECASE)
    if m:
        return f"3100 22 {m.group(1)}"
    return None


def _account_number_hits(text: str, accounts: List[str], numbers: Dict[str, str]) -> List[Tuple[int, str, str]]:
    """Longest matching account number wins (avoids 920117 stealing 920117-1221 files)."""
    hits: List[Tuple[int, str, str]] = []
    for account in accounts:
        num = (numbers.get(account) or "").strip()
        if not num or len(num) < 4:
            continue
        if number_in_text(num, text):
            hits.append((len(re.sub(r"\s", "", num)), account, num))
    hits.sort(key=lambda x: x[0], reverse=True)
    return hits


def _infer_from_filename(filename: str, accounts: List[str], numbers: Dict[str, str]) -> Optional[tuple[str, float, List[str]]]:
    hits = _account_number_hits(filename, accounts, numbers)
    if hits:
        _, account, num = hits[0]
        return account, 0.95, [f"filnamn innehåller {num}"]
    return None


def _infer_from_csv_fields(content: str, accounts: List[str], numbers: Dict[str, str]) -> Optional[tuple[str, float, List[str]]]:
    """Vote by Avsändare/Mottagare columns — not transfer text in Rubrik."""
    try:
        rows = parse_bank_csv(content)
    except Exception:
        rows = []
    if not rows:
        return None

    votes: Counter[str] = Counter()
    for row in rows:
        for field in (row.get("sender"), row.get("receiver")):
            if not field:
                continue
            for account in accounts:
                num = (numbers.get(account) or "").strip()
                if num and number_in_text(num, field):
                    votes[account] += 1
    if not votes:
        return None
    account, count = votes.most_common(1)[0]
    num = numbers.get(account, "")
    return account, 0.9, [f"kontonummer {num} i avsändare/mottagare ({count} rader)"]


def _score_text(text: str, account: str, hints: List[str]) -> Tuple[float, List[str]]:
    norm = _norm(text)
    reasons: List[str] = []
    score = 0.0

    acc_norm = _norm(account)
    if acc_norm in norm or norm in acc_norm:
        score += 0.35
        reasons.append("matchar kontonamn")

    for hint in hints:
        if re.search(hint, norm, re.IGNORECASE):
            score += 0.25
            reasons.append(f"träff: {hint}")

    for bank_key, bank_word in BANK_HINTS.items():
        if bank_word in acc_norm and bank_key in norm:
            score += 0.15
            reasons.append(f"bank: {bank_key}")

    return min(score, 1.0), reasons


def account_display_number(name: str) -> Optional[str]:
    from app.services.finance.config import account_number_for

    num = account_number_for(name)
    return num or None


def detect_account(
    filename: str,
    content: str,
    accounts: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Return detection result with suggested account and ranked candidates."""
    from app.services.finance.config import get_finance_config

    accounts = accounts or list(ACCOUNT_HINTS.keys())
    numbers = get_finance_config().get("account_numbers") or {}

    for hit in (
        _infer_from_filename(filename, accounts, numbers),
        _infer_from_csv_fields(content, accounts, numbers),
    ):
        if hit:
            account, score, reasons = hit
            return {
                "filename": filename,
                "detected_account": account,
                "confidence": score,
                "auto_detected": True,
                "candidates": [{"account": account, "score": score, "reasons": reasons}],
                "accounts": accounts,
                "is_csv": filename.lower().endswith(".csv") or "bokföringsdag" in content.lower()[:800],
            }

    candidates: List[Dict[str, Any]] = []
    for account in accounts:
        hints = list(ACCOUNT_HINTS.get(account, []))
        tokens = [re.escape(t) for t in re.split(r"\s+", account) if len(t) > 3]
        hints.extend(rf"\b{t}\b" for t in tokens)

        file_score, file_reasons = _score_text(filename, account, hints)
        # Header only — avoid matching transfer counterparty numbers in body
        header_block = "\n".join(content.splitlines()[:6])
        body_score, body_reasons = _score_text(header_block, account, hints)

        csv_score = 0.0
        csv_reasons: List[str] = []
        try:
            rows = parse_bank_csv(content)
            if rows:
                csv_score = 0.1
                csv_reasons.append("giltig bank-CSV")
        except Exception:
            pass

        score = min(file_score * 0.45 + body_score * 0.45 + csv_score, 1.0)
        if score > 0:
            candidates.append({
                "account": account,
                "score": round(score, 3),
                "reasons": list(dict.fromkeys(file_reasons + body_reasons + csv_reasons)),
            })

    candidates.sort(key=lambda c: c["score"], reverse=True)

    detected: Optional[str] = None
    confidence = 0.0
    if candidates:
        top = candidates[0]
        second = candidates[1]["score"] if len(candidates) > 1 else 0.0
        if top["score"] >= AUTO_THRESHOLD and (top["score"] - second) >= AUTO_MIN_GAP:
            detected = top["account"]
            confidence = top["score"]

    return {
        "filename": filename,
        "detected_account": detected,
        "confidence": confidence,
        "auto_detected": detected is not None,
        "candidates": candidates[:5],
        "accounts": accounts,
        "is_csv": filename.lower().endswith(".csv") or "bokföringsdag" in content.lower()[:500],
    }
