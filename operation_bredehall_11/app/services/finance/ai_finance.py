"""Optional AI categorizer.

Works with any OpenAI-compatible endpoint. Designed for a local LM Studio
server (base_url http://localhost:1234/v1) but also works with OpenAI cloud.
Always degrades gracefully: if no client/endpoint is available the caller
should fall back to the rule-based categorizer.
"""
from __future__ import annotations

import json
import os
import time
from typing import Any, Dict, List, Optional

from app.services.finance.categorizer import CATEGORIES

CONFIDENCE_THRESHOLD = 0.55


def get_ai_settings(config: Dict[str, Any]) -> Dict[str, Any]:
    """Resolve AI settings from finance config + environment."""
    return {
        "enabled": bool(config.get("ai_enabled", False)),
        "base_url": (config.get("ai_base_url") or os.environ.get("FINANCE_AI_BASE_URL") or "http://localhost:1234/v1").strip(),
        "api_key": (config.get("ai_api_key") or os.environ.get("FINANCE_AI_API_KEY") or "lm-studio").strip(),
        "model": (config.get("ai_model") or os.environ.get("FINANCE_AI_MODEL") or "local-model").strip(),
    }


def _get_client(settings: Dict[str, Any]):
    try:
        from openai import OpenAI
    except ImportError:
        return None
    try:
        return OpenAI(base_url=settings["base_url"], api_key=settings["api_key"] or "not-needed")
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
        return {"ok": True, "base_url": settings["base_url"], "models": ids, "configured_model": settings["model"]}
    except Exception as e:
        return {"ok": False, "error": str(e), "base_url": settings["base_url"]}


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


def categorize_batch(
    transactions: List[Dict[str, Any]],
    config: Dict[str, Any],
    retries: int = 2,
) -> Dict[str, Any]:
    """
    Classify a single batch of transactions.
    Returns {ok, mapping, skipped, errors, preview}
    """
    settings = get_ai_settings(config)
    if not settings["enabled"]:
        return {"ok": False, "mapping": {}, "skipped": [], "errors": ["AI-kategorisering är avstängd."], "preview": []}
    client = _get_client(settings)
    if client is None:
        return {"ok": False, "mapping": {}, "skipped": [], "errors": ["AI-klient ej tillgänglig."], "preview": []}

    if not transactions:
        return {"ok": True, "mapping": {}, "skipped": [], "errors": [], "preview": []}

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

    mapping: Dict[int, str] = {}
    skipped: List[int] = []
    errors: List[str] = []
    preview: List[Dict[str, Any]] = []

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
            return {"ok": True, "mapping": mapping, "skipped": skipped, "errors": errors, "preview": preview}
        except Exception as e:
            last_err = str(e)
            if attempt < retries:
                time.sleep(1.5 * (attempt + 1))
            else:
                errors.append(last_err)

    return {"ok": False, "mapping": mapping, "skipped": skipped, "errors": errors, "preview": preview}


def categorize_with_ai(
    transactions: List[Dict[str, Any]],
    config: Dict[str, Any],
    batch_size: int = 25,
) -> Dict[str, Any]:
    """Legacy all-in-one helper (used by old recategorize endpoint)."""
    mapping: Dict[int, str] = {}
    errors: List[str] = []
    used = 0
    skipped_total = 0

    for i in range(0, len(transactions), batch_size):
        batch = transactions[i : i + batch_size]
        result = categorize_batch(batch, config)
        mapping.update(result.get("mapping", {}))
        skipped_total += len(result.get("skipped", []))
        errors.extend(result.get("errors", []))
        used += len(batch)

    return {
        "ok": len(mapping) > 0 or used > 0,
        "mapping": mapping,
        "errors": errors,
        "used": used,
        "skipped": skipped_total,
    }


def _strip_code_fence(text: str) -> str:
    if text.startswith("```"):
        lines = text.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines)
    if "</think>" in text:
        text = text.split("</think>")[-1].strip()
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
        )
        raw = _strip_code_fence((resp.choices[0].message.content or "").strip())
        data = json.loads(raw)
        loans = _normalize_loan_items(data.get("loans", []))
        if not loans:
            return {"ok": False, "loans": [], "errors": ["Kunde inte hitta några lån i texten."]}
        return {"ok": True, "loans": loans, "errors": []}
    except Exception as e:
        return {"ok": False, "loans": [], "errors": [str(e)]}


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
            "errors": [f"Vision-tolkning misslyckades: {e}. Prova klistra in text istället."],
        }
