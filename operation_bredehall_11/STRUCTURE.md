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

```text
app/static/js/app.js
  → app/routers/finance.py
    → services/finance/upload.py      # spara CSV i inbox per konto
    → services/finance/processor.py   # läs inbox/Drive, parse, arkivera
    → services/finance/csv_parser.py  # svenska bankformat, belopp/datum
    → services/finance/categorizer.py # typ + kategori via regler
    → crud_finance.py                 # dedup, låsning, överföringar, lån
    → services/finance/dashboard.py   # summeringar/grafer
```

Viktiga gränser:

- `data/finance/inbox/` och `data/finance/archive/` är arbetsmappar och gitignored.
- `create_transactions_bulk()` hoppar över CSV-dubbletter med konto + datum + öresbelopp + normaliserad beskrivning.
- `update_transaction_category(..., apply_to_similar=True)` låser exakt samma bankbeskrivning och blir inlärning för kommande importer.
- `detect_internal_transfers()` parar motsatta belopp mellan olika konton inom 3 dagar och kräver överföringssignal i text eller `own_accounts_regex`.
- `ai_finance.py` används bara när finance config har `ai_enabled=true`; annars är reglerna den säkra baslinjen.

## Startup och migrationer

`app/main.py` kör vid start:

1. `sync_bundled_data()` kopierar git-versionen av `bredehall.db` och `finance_config.json` till `/data` i HA-containern när hash skiljer.
2. `init_db()` skapar saknade tabeller.
3. `run_migrations()` kör idempotenta SQLite-patchar och sätter WAL.
4. Seed fyller tom uppgifts-/lånedata.
5. Finance-migreringar rättar kända historiska dataproblem och backfillar interna överföringar.

Det betyder att schemaändringar ska läggas i `app/migrations.py` och tåla att köras varje start.
