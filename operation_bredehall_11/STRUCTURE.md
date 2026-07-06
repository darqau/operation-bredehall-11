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

## Startsekvens och driftpunkter

1. `run.sh` läser HA options från `/data/options.json` eller `/config/options.json`, exporterar `APP_API_KEY` om den är satt och startar uvicorn på port `8765` om ingen annan port anges.
2. `app.main.lifespan()` kör `sync_bundled_data()` innan `init_db()` och `run_migrations(engine)`. Det gör att git-versionen av `bredehall.db` och `finance_config.json` vinner över äldre innehåll i HA-volymen när filhasharna skiljer sig.
3. `app.database` väljer datakatalog i ordning: `DATA_DIR`, befintlig `/data`, annars repots `data/`.
4. Finance-startupen migrerar äldre config-namn, synkar HA-optionen `finance_storage_mode` bara när `finance_config.json` saknas, taggar interna överföringar och skriver statisk kategorilista till frontend.

Relevanta tester:

- `tests/test_data_sync.py` verifierar kopiering, hash-skip och samma-katalog-skip.
- `tests/test_processor_archive.py` verifierar att CSV-filer inte arkiveras om DB-importen misslyckas.
