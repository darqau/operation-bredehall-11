# Operation Bredehall 11 – Filstruktur

## Översikt

```
operation_bredehall_11/
├── config.yaml              # HA add-on (direkt port 8765, app_api_key, ingen Ingress)
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
- Committa inte `bredehall.db-wal`, `bredehall.db-shm` eller `data/finance/` (CSV-inbox/arkiv)

## Startsekvens

`app.main.lifespan()` kör samma initiering lokalt och i add-onen:

1. `app.data_sync.sync_bundled_data()` kopierar `bredehall.db` och
   `finance_config.json` från git-bundlen till `/data` i HA-containern när
   hash skiljer sig. Lokalt är käll- och målmappar samma och inget kopieras.
2. `init_db()` skapar saknade tabeller och `run_migrations(engine)` kör
   idempotenta SQLite-migreringar.
3. `seed_if_empty()` och `seed_loans_if_empty()` fyller bara tomma installationer.
4. `_migrate_finance_on_startup()` normaliserar äldre kontonamn/config och läser
   HA-optionen `finance_storage_mode` endast när `finance_config.json` saknas.
5. `_tag_internal_transfers_on_startup()` märker historiska egna överföringar.
6. `_sync_finance_categories_static()` skriver `static/data/finance-categories.json`
   för frontenden.

## Finance-arkitektur

| Modul | Ansvar |
|-------|--------|
| `app/routers/finance.py` | Publika `/api/finance/*`-endpoints för config, mappar, import, dashboard, transaktioner, jämförelse, AI och lån. |
| `app/services/finance/config.py` | Läser/skriver `finance_config.json`, skapar inbox/archive-mappar och migrerar äldre kontonamn. |
| `app/services/finance/detect.py` | Konto-detektering från filnamn, kontonummer och CSV-innehåll. |
| `app/services/finance/csv_parser.py` | Bank-CSV till normaliserade rader. |
| `app/services/finance/processor.py` | Importflöde för lokal inbox eller Google Drive, dedup, arkivering och aktivitetslogg. |
| `app/services/finance/dashboard.py` | Aggregat för dashboard, hero och kontojämförelse. |
| `app/services/finance/activity_log.py` | Persistens för import-, AI-, manuell- och konto-händelser. |
| `app/services/finance/ai_finance.py` | OpenAI-kompatibel kategorisering och lånetolkning. |
| `app/crud_finance.py` | Transaktions-/låne-CRUD, filter, summering, dedup-fingerprints och kategoriinlärning. |

### Importflöde

```
CSV/upload/Drive
  → detect_account(...)
  → parse_bank_csv(...)
  → enrich_transaction(...) + apply_learned_category(...)
  → create_transactions_bulk(...)
  → detect_internal_transfers(...)
  → archive/logga resultat
```

Källkodens viktiga invariants:

- Dedup gäller bara importerade bankrader och använder
  `(account, txn_date, amount_ore, normalized_description)`.
- Lokala CSV-filer arkiveras först efter lyckad DB-insättning.
- `unknown_files` lämnas i inbox så användaren kan rätta konto/config.
- `rerouted` betyder att filen låg i en konto-inbox men matchade ett annat konto.
- `GET /api/finance/transactions` använder samma filter för lista, total och
  `sum_amount`; paginering påverkar bara `items`.
- Dashboard-grafer kan exkludera överföringar, `Bostadsköp (engång)`,
  beskrivningar med `slutlikvid` och belopp över `chart_max_amount`.
