"""Optional AI categorizer.

Works with any OpenAI-compatible endpoint. Designed for a local LM Studio
server (base_url http://localhost:1234/v1) but also works with OpenAI cloud.
Always degrades gracefully: if no client/endpoint is available the caller
should fall back to the rule-based categorizer.
"""
from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional

from app.services.finance.categorizer import CATEGORIES


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
    "Du är en svensk privatekonomi-assistent. Klassificera banktransaktioner i EXAKT en "
    "av dessa kategorier: {cats}. Svara ENDAST med giltig JSON enligt formatet "
    '{{"results": [{{"id": <int>, "category": "<kategori>"}}]}}. Ingen annan text.'
)


def categorize_with_ai(
    transactions: List[Dict[str, Any]],
    config: Dict[str, Any],
    batch_size: int = 25,
) -> Dict[str, Any]:
    """
    transactions: list of {id, description, amount, typ}
    Returns {ok, mapping: {id: category}, used, errors}
    """
    settings = get_ai_settings(config)
    client = _get_client(settings)
    if client is None:
        return {"ok": False, "mapping": {}, "errors": ["AI-klient ej tillgänglig."], "used": 0}

    cats = ", ".join(CATEGORIES)
    system = _SYSTEM_PROMPT.format(cats=cats)
    mapping: Dict[int, str] = {}
    errors: List[str] = []
    used = 0

    for i in range(0, len(transactions), batch_size):
        batch = transactions[i : i + batch_size]
        lines = [
            {
                "id": t["id"],
                "text": (t.get("description") or "")[:120],
                "amount": round(float(t.get("amount", 0)), 2),
                "typ": t.get("typ", ""),
            }
            for t in batch
        ]
        user = "Klassificera dessa transaktioner:\n" + json.dumps(lines, ensure_ascii=False)
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
                cat = str(item["category"]).strip()
                if cat in CATEGORIES:
                    mapping[tid] = cat
            used += len(batch)
        except Exception as e:
            errors.append(f"Batch {i // batch_size + 1}: {e}")

    return {"ok": len(mapping) > 0, "mapping": mapping, "errors": errors, "used": used}


def _strip_code_fence(text: str) -> str:
    if text.startswith("```"):
        lines = text.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines)
    # Some models wrap with <think> ... </think>
    if "</think>" in text:
        text = text.split("</think>")[-1].strip()
    # Extract first JSON object if extra prose remains
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        return text[start : end + 1]
    return text
