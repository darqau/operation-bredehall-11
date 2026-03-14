"""AI-assistent: analysera underhållsplan, sök bidrag (OpenAI)."""
import os
from typing import Any, Dict, List, Optional

# Lista med uppgifter som dict (title, category, frequency, next_deadline, reason, description)
TASKS_TYPE = List[Dict[str, Any]]


def _get_api_key() -> str:
    """Hämta OpenAI API-nyckel från env eller HA add-on options (/config/options.json)."""
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if key:
        return key
    for path in ("/data/options.json", "/config/options.json"):
        try:
            if os.path.isfile(path):
                import json
                with open(path, encoding="utf-8") as f:
                    opts = json.load(f)
                key = (opts.get("openai_api_key") or "").strip()
                if key:
                    return key
        except Exception:
            pass
    return ""


def _get_client():
    """OpenAI-klient om API-nyckel finns."""
    try:
        from openai import OpenAI
    except ImportError:
        return None
    key = _get_api_key()
    if not key:
        return None
    return OpenAI(api_key=key)


def analyze_plan(tasks: TASKS_TYPE) -> Dict[str, Any]:
    """
    Skickar uppgiftslistan till LLM och returnerar analys + förslag på saknade underhållsåtgärder
    för en typisk svensk villa.
    """
    client = _get_client()
    if not client:
        return {
            "ok": False,
            "error": "OpenAI API-nyckel saknas. Lägg in OPENAI_API_KEY i add-onens konfiguration.",
            "analysis": None,
            "suggestions": [],
        }
    task_summaries = []
    for t in tasks:
        task_summaries.append(
            f"- {t.get('title', '')} (kategori: {t.get('category', '')}, frekvens: {t.get('frequency', '')}, "
            f"nästa deadline: {t.get('next_deadline') or '–'})"
        )
    tasks_text = "\n".join(task_summaries) if task_summaries else "Inga uppgifter i planen än."
    prompt = f"""Du är en erfaren underhållsplanerare för svenska villor. Analysera följande underhållsplan och ge:
1. En kort sammanfattning (2–3 meningar) av vad som täcks och eventuella luckor.
2. En lista med konkreta förslag på underhållsåtgärder som ofta saknas i en svensk villa (t.ex. brandvarnare, vattenstopp, avlopp, tak, ventilation, säkringar). För varje förslag ange: titel, kategori (Hus/Trädgård/VVS/Ekonomi/Administration/El/Värme/Annat), frekvens (En gång/Årlig/Kvartalsvis/etc.), kort motivering.

Svara i JSON-format med nycklarna "summary" (str) och "suggestions" (lista av objekt med "title", "category", "frequency", "reason"). Inga andra texter.

Aktuell underhållsplan:
{tasks_text}
"""
    try:
        r = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
        )
        text = (r.choices[0].message.content or "").strip()
        # Ta bort eventuella markdown-kodblock
        if text.startswith("```"):
            lines = text.split("\n")
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            text = "\n".join(lines)
        import json
        data = json.loads(text)
        return {
            "ok": True,
            "error": None,
            "analysis": data.get("summary", ""),
            "suggestions": data.get("suggestions", []),
        }
    except Exception as e:
        return {
            "ok": False,
            "error": str(e),
            "analysis": None,
            "suggestions": [],
        }


def search_grants() -> Dict[str, Any]:
    """Söker/sammanställer information om aktuella svenska bidrag för husägare (ROT, grönt avdrag, energieffektivisering m.m.)."""
    client = _get_client()
    if not client:
        return {
            "ok": False,
            "error": "OpenAI API-nyckel saknas. Lägg in OPENAI_API_KEY i add-onens konfiguration.",
            "text": None,
        }
    prompt = """Sammanställ kort (på svenska) aktuella svenska bidrag och skattereduktioner för husägare som är relevanta 2025–2026. Inkludera t.ex. ROT-avdrag, grönt avdrag, stöd för energieffektivisering, solceller, värmepumpar. För varje: namn, kort beskrivning, vilka som kan söka. Håll texten överskådlig (punktlistor). Svara med vanlig text, ingen JSON."""
    try:
        r = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.4,
        )
        text = (r.choices[0].message.content or "").strip()
        return {"ok": True, "error": None, "text": text}
    except Exception as e:
        return {"ok": False, "error": str(e), "text": None}
