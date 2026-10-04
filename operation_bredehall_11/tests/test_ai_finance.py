"""Unit tests for AI finance helpers (no live LM Studio required)."""
from __future__ import annotations

import json

from app.services.finance.ai_finance import (
    DEFAULT_BATCH_SIZE,
    DEFAULT_TIMEOUT_SECONDS,
    _strip_code_fence,
    get_ai_settings,
)


def test_strip_gemma_channel_json():
    raw = '<|channel>thought\n<channel|>{"results":[{"id":1,"category":"Livsmedel","confidence":0.9}]}'
    out = _strip_code_fence(raw)
    data = json.loads(out)
    assert data["results"][0]["id"] == 1


def test_strip_gemma_channel_fenced_json():
    raw = (
        "<|channel>thought\n<channel|>```json\n"
        '{\n  "results": [{"id": 2, "category": "Övrigt", "confidence": 0.4}]\n}\n'
        "```"
    )
    out = _strip_code_fence(raw)
    data = json.loads(out)
    assert data["results"][0]["id"] == 2


def test_strip_think_block():
    raw = '<think>resonemang</think>\n{"results":[{"id":3,"category":"Lön","confidence":1.0}]}'
    out = _strip_code_fence(raw)
    assert json.loads(out)["results"][0]["id"] == 3


def test_get_ai_settings_defaults_and_clamps():
    s = get_ai_settings({"ai_enabled": True})
    assert s["timeout_seconds"] == DEFAULT_TIMEOUT_SECONDS
    assert s["batch_size"] == DEFAULT_BATCH_SIZE

    s2 = get_ai_settings({"ai_timeout_seconds": 10, "ai_batch_size": 99})
    assert s2["timeout_seconds"] == 60
    assert s2["batch_size"] == 30
