"""Optional API-key auth for direct port access (Tailscale / LAN).

When APP_API_KEY / HA option app_api_key is empty, all requests pass through
(local development). HA Ingress requests (X-Ingress-Path header) are always
allowed because Home Assistant already authenticated the user.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse


PUBLIC_PREFIXES = ("/health", "/static/", "/api/auth/status")


def _read_ha_option(key: str) -> str:
    for path in ("/data/options.json", "/config/options.json"):
        p = Path(path)
        if not p.is_file():
            continue
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            val = (data.get(key) or "").strip()
            if val:
                return val
        except (json.JSONDecodeError, OSError):
            continue
    return ""


def get_app_api_key() -> str:
    return (os.environ.get("APP_API_KEY") or _read_ha_option("app_api_key") or "").strip()


def _is_public(path: str) -> bool:
    if path == "/":
        return True
    return any(path.startswith(prefix) for prefix in PUBLIC_PREFIXES)


class ApiKeyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        key = get_app_api_key()
        if not key:
            return await call_next(request)

        if request.headers.get("X-Ingress-Path"):
            return await call_next(request)

        path = request.url.path
        if _is_public(path):
            return await call_next(request)

        provided = request.headers.get("X-API-Key") or request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
        if provided == key:
            return await call_next(request)

        return JSONResponse({"detail": "Ogiltig eller saknad API-nyckel."}, status_code=401)
