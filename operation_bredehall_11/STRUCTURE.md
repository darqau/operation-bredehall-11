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
│   ├── data_sync.py         # Git-data → /data i HA-containern
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
└── data/                    # I git: bredehall.db + finance_config.json
                             # Lokalt gitignored: finance/ CSV-arkiv
```

## Data

- **`bredehall.db`** + **`finance_config.json`** committas till git (privat repo)
- HA add-on: vid start kopieras bundlade filer till `/data` om innehållet skiljer sig (`DATA_DIR=/data` i Dockerfile)
- **Lokal utveckling:** alltid `operation_bredehall_11/data/` — `launch.py` sätter `DATA_DIR`; utan env används samma mapp automatiskt
- Använd **inte** `c:\data` på Windows (tidigare bugg — borttagen)
- Stoppa lokal server innan commit så databasen hinner stängas rent (se Inställningar i appen)
