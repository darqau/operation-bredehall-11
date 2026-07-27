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
│   ├── services/finance/    # CSV/GDrive-import, dashboard/hero, kategorisering, AI, config
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

## Ekonomimodul

- **`routers/finance.py`** exponerar import, dashboard, transaktionsfilter,
  kategoriredigering, recategorize och lån/skulder under `/api/finance/*`.
- **`crud_finance.py`** äger DB-operationer: dedup, gemensamma filter för lista/count/summa,
  låsta kategorier, intern överföringsdetektion och lån.
- **`services/finance/processor.py`** läser CSV från lokal inbox eller Google Drive, använder
  lärda kategorier före regelmotorn och arkiverar lokala filer först efter lyckad import.
- **`services/finance/dashboard.py`** bygger grafer, hero-nyckeltal, senaste saldon per konto
  och nettoförmögenhet med lån/skulder.
- **`services/finance/categorizer.py`** är den deterministiska regelmotorn för `typ` och
  `category`; AI-flödet är ett valfritt komplement för okategoriserade rader.
