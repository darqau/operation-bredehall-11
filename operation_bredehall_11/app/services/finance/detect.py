"""Guess which account folder a bank CSV belongs to."""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple, Tuple

from app.services.finance.csv_parser import parse_bank_csv

# Account numbers / patterns → folder (most specific first)
ACCOUNT_NUMBER_MAP: List[tuple[str, str]] = [
    (r"1936\s*20\s*14939", "Gemensamt Nordea"),
    (r"920117[- ]?1221", "Lönekonto Nordea"),
    (r"9735695422", "Lönekonto Swedbank"),
    (r"3100\s*22\s*43645", "Linneas CSN"),
    (r"3100\s*22\s*43661", "Linneas CSN"),
    (r"1127\s*21\s*36671", "Patriks Lönekonto"),
    (r"3055\s*01\s*01268", "Linneas Sparkonto"),
    (r"3300", "Lönekonto Swedbank"),
]

# Human-readable account numbers for UI (account name → display number)
ACCOUNT_DISPLAY_NUMBERS: Dict[str, str] = {
    "Gemensamt Nordea": "1936 20 14939",
    "Lönekonto Nordea": "920117-1221",
    "Lönekonto Swedbank": "9735695422",
    "Linneas CSN": "3100 22 43645",
    "Patriks Lönekonto": "1127 21 36671",
    "Linneas Sparkonto": "3055 01 01268",
}


def account_display_number(name: str) -> Optional[str]:
    """Display number for a configured bank account (from finance_config.json)."""
    from app.services.finance.config import account_number_for

    num = account_number_for(name)
    return num or ACCOUNT_DISPLAY_NUMBERS.get(name) or None

ACCOUNT_HINTS: Dict[str, List[str]] = {
    "Gemensamt Nordea": [r"gemensamt", r"1936\s*20", r"personkonto.*1936", r"1936.*personkonto"],
    "Lönekonto Nordea": [r"lönekonto.*nordea", r"nordea.*lön", r"920117"],
    "Lönekonto Swedbank": [r"lönekonto.*swed", r"swedbank.*lön", r"9735695422", r"transaktioner"],
    "Linneas CSN": [r"linnea.*csn", r"sparkonto.*3100", r"3100\s*22"],
    "Patriks Lönekonto": [r"patriks?\s*löne", r"patrik.*lönekonto", r"1127\s*21\s*36671", r"\b1127\b"],
    "Linneas Sparkonto": [r"linnea.*spar", r"linneas\s*spark", r"3055"],
    "Patriks Sparkonto": [r"patrik.*spar", r"patriks\s*spar"],
    "Räkningar Swedbank": [r"räkning", r"rakning", r"swedbank.*räk", r"faktura"],
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


def _match_account_numbers(text: str, accounts: List[str]) -> Optional[tuple[str, float, List[str]]]:
    norm = text
    for pattern, account in ACCOUNT_NUMBER_MAP:
        if re.search(pattern, norm, re.IGNORECASE):
            return account, 0.85, [f"kontonummer: {pattern}"]
    return None


def detect_account(
    filename: str,
    content: str,
    accounts: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Return detection result with suggested account and ranked candidates.
    """
    accounts = accounts or list(ACCOUNT_HINTS.keys())
    combined = f"{filename}\n{content[:8000]}"

    num_hit = _match_account_numbers(combined, accounts)
    if num_hit:
        account, score, reasons = num_hit
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
        hints = ACCOUNT_HINTS.get(account, [])
        # Also derive hints from account name tokens
        tokens = [re.escape(t) for t in re.split(r"\s+", account) if len(t) > 3]
        hints = hints + [rf"\b{t}\b" for t in tokens]

        file_score, file_reasons = _score_text(filename, account, hints)
        body_score, body_reasons = _score_text(content[:4000], account, hints)

        # Parsed CSV: boost if valid bank export
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
