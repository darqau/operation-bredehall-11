"""Optional AI categorizer.

Works with any OpenAI-compatible endpoint. Designed for a local LM Studio
server (base_url http://localhost:1234/v1) but also works with OpenAI cloud.
Always degrades gracefully: if no client/endpoint is available the caller
should fall back to the rule-based categorizer.

Local models (e.g. Gemma 9B/12B) are slow — default batch size is small and
read timeout is generous. See ai_timeout_seconds / ai_batch_size in finance config.
"""
from __future__ import annotations

import json
import os
import re
import time
from typing import Any, Dict, List, Optional

from app.services.finance.categorizer import CATEGORIES

CONFIDENCE_THRESHOLD = 0.55
DEFAULT_TIMEOUT_SECONDS = 300
DEFAULT_BATCH_SIZE = 5
# Enough for JSON results; thinking/channel markers use little extra when empty.
_TOKENS_PER_TXN = 80
_TOKENS_BASE = 128


def get_ai_settings(config: Dict[str, Any]) -> Dict[str, Any]:
    """Resolve AI settings from finance config + environment."""
    try:
        timeout = int(
            config.get("ai_timeout_seconds")
            or os.environ.get("FINANCE_AI_TIMEOUT")
            or DEFAULT_TIMEOUT_SECONDS
        )
    except (TypeError, ValueError):
        timeout = DEFAULT_TIMEOUT_SECONDS
    timeout = max(60, min(timeout, 1800))

    try:
        batch_size = int(
            config.get("ai_batch_size")
            or os.environ.get("FINANCE_AI_BATCH_SIZE")
            or DEFAULT_BATCH_SIZE
        )
    except (TypeError, ValueError):
        batch_size = DEFAULT_BATCH_SIZE
    batch_size = max(1, min(batch_size, 30))

    return {
        "enabled": bool(config.get("ai_enabled", False)),
        "base_url": (
            config.get("ai_base_url")
            or os.environ.get("FINANCE_AI_BASE_URL")
            or "http://localhost:1234/v1"
        ).strip(),
        "api_key": (
            config.get("ai_api_key")
            or os.environ.get("FINANCE_AI_API_KEY")
            or "lm-studio"
        ).strip(),
        "model": (
            config.get("ai_model")
            or os.environ.get("FINANCE_AI_MODEL")
            or "local-model"
        ).strip(),
        "timeout_seconds": timeout,
        "batch_size": batch_size,
    }


def _get_client(settings: Dict[str, Any]):
    try:
        from openai import OpenAI
    except ImportError:
        return None
    try:
        # max_retries=0: local models are slow; SDK retries would look like a hang.
        return OpenAI(
            base_url=settings["base_url"],
            api_key=settings["api_key"] or "not-needed",
            timeout=float(settings.get("timeout_seconds") or DEFAULT_TIMEOUT_SECONDS),
            max_retries=0,
        )
    except Exception:
        return None


def test_connection(config: Dict[str, Any]) -> Dict[str, Any]:
    """Ping the configured endpoint and list available models."""
    settings = get_ai_settings(config)
    client = _get_client(settings)
    if client is None:
        return {"ok": False, "error": "OpenAI-klientbiblioteket saknas eller kunde inte initieras."}
    try:
        models = client.models.list()
        ids = [m.id for m in getattr(models, "data", [])][:20]
        return {
            "ok": True,
            "base_url": settings["base_url"],
            "models": ids,
            "configured_model": settings["model"],
            "timeout_seconds": settings["timeout_seconds"],
            "batch_size": settings["batch_size"],
        }
    except Exception as e:
        return {"ok": False, "error": _friendly_error(e), "base_url": settings["base_url"]}


_SYSTEM_PROMPT = (
    "Du är en svensk privatekonomi-assistent. Klassificera banktransaktioner.\n"
    "Tillåtna kategorier: {cats}.\n\n"
    "Svara ENDAST med giltig JSON:\n"
    '{{"results": [{{"id": <int>, "category": "<kategori>", "confidence": <0.0-1.0>}}]}}\n\n'
    "Regler:\n"
    "- Välj EXAKT en kategori från listan.\n"
    "- Om du är osäker (confidence < 0.55), sätt category till \"Övrigt\".\n"
    "- Lämna aldrig en transaktion utan resultat — inkludera alla id:n.\n"
    "- Ingen annan text än JSON."
)


def _friendly_error(exc: BaseException) -> str:
    name = type(exc).__name__
    msg = str(exc) or name
    low = msg.lower()
    if "timeout" in low or "timed out" in low or name in ("APITimeoutError", "ReadTimeout", "TimeoutError"):
        return (
            "Timeout mot LM Studio — modellen hann inte svara i tid. "
            "Prova mindre batch (ai_batch_size) eller höj ai_timeout_seconds i Inställningar."
        )
    if "connection" in low or "connect" in low or name in ("APIConnectionError", "ConnectError"):
        return f"Kunde inte ansluta till AI-servern: {msg}"
    return msg


def categorize_batch(
    transactions: List[Dict[str, Any]],
    config: Dict[str, Any],
    retries: int = 1,
) -> Dict[str, Any]:
    """
    Classify a single batch of transactions.
    Returns {ok, mapping, skipped, reviewed_ids, errors, preview, elapsed_seconds}
    """
    settings = get_ai_settings(config)
    empty = {
        "ok": False,
        "mapping": {},
        "skipped": [],
        "reviewed_ids": [],
        "errors": [],
        "preview": [],
        "elapsed_seconds": 0.0,
    }
    if not settings["enabled"]:
        empty["errors"] = ["AI-kategorisering är avstängd."]
        return empty
    client = _get_client(settings)
    if client is None:
        empty["errors"] = ["AI-klient ej tillgänglig."]
        return empty

    if not transactions:
        empty["ok"] = True
        return empty

    cats = ", ".join(CATEGORIES)
    system = _SYSTEM_PROMPT.format(cats=cats)
    lines = [
        {
            "id": t["id"],
            "text": (t.get("description") or "")[:120],
            "amount": round(float(t.get("amount", 0)), 2),
            "typ": t.get("typ", ""),
        }
        for t in transactions
    ]
    user = "Klassificera dessa transaktioner:\n" + json.dumps(lines, ensure_ascii=False)
    max_tokens = _TOKENS_BASE + len(transactions) * _TOKENS_PER_TXN

    mapping: Dict[int, str] = {}
    skipped: List[int] = []
    errors: List[str] = []
    preview: List[Dict[str, Any]] = []
    t0 = time.time()

    last_err: Optional[str] = None
    for attempt in range(retries + 1):
        try:
            resp = client.chat.completions.create(
                model=settings["model"],
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                temperature=0.1,
                max_tokens=max_tokens,
            )
            text = (resp.choices[0].message.content or "").strip()
            text = _strip_code_fence(text)
            data = json.loads(text)
            for item in data.get("results", []):
                tid = int(item["id"])
                cat = str(item.get("category", "Övrigt")).strip()
                conf = float(item.get("confidence", 0.5))
                if cat not in CATEGORIES:
                    cat = "Övrigt"
                    conf = 0.0
                if conf < CONFIDENCE_THRESHOLD:
                    skipped.append(tid)
                    cat = "Övrigt"
                if cat != "Övrigt":
                    mapping[tid] = cat
                preview.append({"id": tid, "category": cat, "confidence": round(conf, 2)})
            # Mark entire batch reviewed so the queue advances even if some stay Övrigt.
            reviewed_ids = [int(t["id"]) for t in transactions]
            return {
                "ok": True,
                "mapping": mapping,
                "skipped": skipped,
                "reviewed_ids": reviewed_ids,
                "errors": errors,
                "preview": preview,
                "elapsed_seconds": round(time.time() - t0, 1),
            }
        except Exception as e:
            last_err = _friendly_error(e)
            if attempt < retries:
                time.sleep(1.5 * (attempt + 1))
            else:
                errors.append(last_err)

    return {
        "ok": False,
        "mapping": mapping,
        "skipped": skipped,
        "reviewed_ids": [],
        "errors": errors,
        "preview": preview,
        "elapsed_seconds": round(time.time() - t0, 1),
    }


def categorize_with_ai(
    transactions: List[Dict[str, Any]],
    config: Dict[str, Any],
    batch_size: Optional[int] = None,
) -> Dict[str, Any]:
    """Legacy all-in-one helper (used by old recategorize endpoint)."""
    settings = get_ai_settings(config)
    size = batch_size or settings["batch_size"]
    mapping: Dict[int, str] = {}
    errors: List[str] = []
    used = 0
    skipped_total = 0
    reviewed_total = 0

    for i in range(0, len(transactions), size):
        batch = transactions[i : i + size]
        result = categorize_batch(batch, config)
        mapping.update(result.get("mapping", {}))
        skipped_total += len(result.get("skipped", []))
        reviewed_total += len(result.get("reviewed_ids", []))
        errors.extend(result.get("errors", []))
        used += len(batch)

    return {
        "ok": len(mapping) > 0 or used > 0,
        "mapping": mapping,
        "errors": errors,
        "used": used,
        "skipped": skipped_total,
        "reviewed": reviewed_total,
    }


def _strip_code_fence(text: str) -> str:
    """Extract JSON object from model output (fences, Gemma channels, think blocks)."""
    text = (text or "").strip()
    # Gemma-4 style: <|channel>thought ... <channel|>JSON
    if "<|channel>" in text or "<channel|>" in text:
        for marker in ("<channel|>", "<|channel|>"):
            if marker in text:
                text = text.rsplit(marker, 1)[-1].strip()
                break
    # Drop leading reasoning blocks used by some local models.
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r"</?think>", "", text, flags=re.IGNORECASE).strip()
    if text.startswith("```"):
        lines = text.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        return text[start : end + 1]
    return text


_LOAN_PARSE_SYSTEM = (
    "Du extraherar lån/skulder från svensk bankinformation (t.ex. Nordea bolån).\n"
    "Svara ENDAST med giltig JSON:\n"
    '{{"loans": [{{"label": "<namn>", "account_number": "<kontonummer>", '
    '"amount": <positivt belopp i SEK som tal>, "typ": "bolån", "notes": "<valfritt>"}}]}}\n\n'
    "Regler:\n"
    "- amount ska vara positivt (skuldens storlek).\n"
    "- account_number som visas i banken, med mellanslag om så visas.\n"
    "- Om total summa anges men inga konton, returnera tom loans-lista.\n"
    "- Ingen annan text än JSON."
)


def _normalize_loan_items(raw_items: list) -> List[Dict[str, Any]]:
    loans: List[Dict[str, Any]] = []
    for item in raw_items or []:
        try:
            amount = float(item.get("amount", 0))
        except (TypeError, ValueError):
            continue
        account = str(item.get("account_number") or "").strip()
        if not account or amount <= 0:
            continue
        loans.append({
            "label": str(item.get("label") or "Bolån").strip() or "Bolån",
            "account_number": account,
            "amount": round(amount, 2),
            "typ": str(item.get("typ") or "bolån").strip() or "bolån",
            "notes": (item.get("notes") or None),
        })
    return loans


def parse_loans_from_text(text: str, config: Dict[str, Any]) -> Dict[str, Any]:
    """Parse loan rows from pasted text via the configured AI endpoint."""
    settings = get_ai_settings(config)
    client = _get_client(settings)
    if client is None:
        return {"ok": False, "loans": [], "errors": ["AI-klient ej tillgänglig."]}

    user = "Extrahera alla lån/skulder från texten:\n\n" + (text or "").strip()
    if not user.strip():
        return {"ok": False, "loans": [], "errors": ["Tom text."]}

    try:
        resp = client.chat.completions.create(
            model=settings["model"],
            messages=[
                {"role": "system", "content": _LOAN_PARSE_SYSTEM},
                {"role": "user", "content": user},
            ],
            temperature=0.1,
            max_tokens=1024,
        )
        raw = _strip_code_fence((resp.choices[0].message.content or "").strip())
        data = json.loads(raw)
        loans = _normalize_loan_items(data.get("loans", []))
        if not loans:
            return {"ok": False, "loans": [], "errors": ["Kunde inte hitta några lån i texten."]}
        return {"ok": True, "loans": loans, "errors": []}
    except Exception as e:
        return {"ok": False, "loans": [], "errors": [_friendly_error(e)]}


def parse_loans_from_image(
    image_bytes: bytes,
    mime_type: str,
    config: Dict[str, Any],
) -> Dict[str, Any]:
    """Parse loan rows from a bank screenshot using vision-capable models."""
    import base64

    settings = get_ai_settings(config)
    client = _get_client(settings)
    if client is None:
        return {"ok": False, "loans": [], "errors": ["AI-klient ej tillgänglig."]}

    if not image_bytes:
        return {"ok": False, "loans": [], "errors": ["Tom bildfil."]}

    mime = (mime_type or "image/png").split(";")[0].strip() or "image/png"
    b64 = base64.b64encode(image_bytes).decode("ascii")
    data_url = f"data:{mime};base64,{b64}"

    try:
        resp = client.chat.completions.create(
            model=settings["model"],
            messages=[
                {"role": "system", "content": _LOAN_PARSE_SYSTEM},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Extrahera alla lån/skulder från bankskärmdumpen."},
                        {"type": "image_url", "image_url": {"url": data_url}},
                    ],
                },
            ],
            temperature=0.1,
            max_tokens=1024,
        )
        raw = _strip_code_fence((resp.choices[0].message.content or "").strip())
        data = json.loads(raw)
        loans = _normalize_loan_items(data.get("loans", []))
        if not loans:
            return {
                "ok": False,
                "loans": [],
                "errors": ["Kunde inte tolka lån från bilden. Prova klistra in text istället."],
            }
        return {"ok": True, "loans": loans, "errors": []}
    except Exception as e:
        return {
            "ok": False,
            "loans": [],
            "errors": [f"Vision-tolkning misslyckades: {_friendly_error(e)}. Prova klistra in text istället."],
        }
