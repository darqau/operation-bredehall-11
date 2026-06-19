import os
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app


def test_auth_disabled_without_key():
    client = TestClient(app)
    r = client.get("/api/auth/status")
    assert r.status_code == 200
    assert r.json()["auth_required"] is False
    r2 = client.get("/health")
    assert r2.status_code == 200


def test_auth_required_with_key():
    with patch.dict(os.environ, {"APP_API_KEY": "secret"}):
        client = TestClient(app)
        assert client.get("/api/finance/meta").status_code == 401
        r = client.get("/api/finance/meta", headers={"X-API-Key": "secret"})
        assert r.status_code == 200


def test_ingress_header_bypasses_key():
    with patch.dict(os.environ, {"APP_API_KEY": "secret"}):
        client = TestClient(app)
        r = client.get("/api/finance/meta", headers={"X-Ingress-Path": "/api/hassio_ingress/xyz"})
        assert r.status_code == 200
