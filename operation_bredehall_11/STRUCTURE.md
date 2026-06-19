# Operation Bredehall 11 – Filstruktur

## Översikt

```
operation_bredehall_11/
├── config.yaml              # HA add-on (Ingress, port, app_api_key)
├── Dockerfile
├── run.sh                   # Start uvicorn, läser HA options
├── requirements.txt
├── requirements-dev.txt     # pytest, httpx
├── README.md
├── tests/                   # pytest-grundsuite
│
├── app/
│   ├── main.py              # FastAPI, auth middleware, startup migrationer
│   ├── database.py          # SQLite + DATA_DIR
│   ├── migrations.py        # Idempotenta ALTER TABLE + WAL
│   ├── models.py            # Task, FinanceTransaction, FinanceLoan
│   ├── schemas.py           # Pydantic API-modeller
│   ├── crud.py              # Uppgifter
│   ├── crud_finance.py      # Transaktioner, lån, dedup, överföringar
│   ├── middleware/auth.py   # Valfri API-nyckel + Ingress-bypass
│   │
│   ├── routers/             # tasks, finance, calendar, ai
│   ├── services/finance/    # import, dashboard, AI, config
│   ├── seed/
│   └── static/              # SPA (index.html, app.js, vendor/)
│
└── data/                    # Lokalt (gitignored): bredehall.db, finance_config.json
```

## Autentisering

- **Lokal dev:** ingen `APP_API_KEY` → öppen access
- **HA direkt port / Tailscale:** sätt `app_api_key` i add-on options
- **HA Ingress:** `X-Ingress-Path`-header → ingen extra nyckel

## Data

- `finance_config.json` i `/data` (HA) eller `operation_bredehall_11/data/` (lokalt)
- Repot innehåller bara exempel-defaults — riktiga konton fylls i via UI
