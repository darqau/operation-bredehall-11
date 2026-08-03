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
- HA add-on: vid start kopieras bundlade filer till `/data` om innehållet skiljer sig
- Lokal dev läser/skriver samma `data/`-mapp — ingen separat databas
- Stoppa lokal server innan commit så databasen hinner stängas rent (se Inställningar i appen)

## Ekonomiflöde

```
CSV upload/inbox
  → services/finance/upload.py      # sanerar filnamn, skapar inbox per konto
  → services/finance/processor.py   # läser local/gdrive, arkiverar efter DB-skrivning
  → services/finance/csv_parser.py  # bank-CSV → normaliserade rader
  → services/finance/categorizer.py # typ/kategori-regler + egna överföringar
  → crud_finance.py                 # dedup, CRUD, kategorilås, lån
  → routers/finance.py              # /api/finance/*
```

Viktiga gränser:

- `crud_finance._apply_txn_filters()` är den gemensamma sanningen för
  transaktionslistans `items`, `total` och `sum_amount`.
- `services/finance/dashboard.py` har egna aggregeringar för dashboard/hero och
  exkluderar stora engångshändelser bara från tidsserier, inte från den sparade
  transaktionshistoriken.
- `data/finance/` är ett lokalt arbets-/arkivområde och ska inte committas.
