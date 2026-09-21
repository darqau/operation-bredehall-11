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

## Ekonomiflöden

### Import

1. `app/routers/finance.py` tar emot uppladdningar via `/api/finance/detect`, `/upload` och `/process`.
2. `app/services/finance/detect.py` föreslår konto från CSV-filnamn/innehåll.
3. `app/services/finance/upload.py` sparar filen i `data/finance/inbox/<konto>`.
4. `app/services/finance/processor.py` läser lokala inbox-mappar eller Google Drive (`storage_mode=gdrive`), parsar CSV och anropar `create_transactions_bulk`.
5. `app/crud_finance.py` deduplicerar importerade bankrader per konto med `datum + amount_ore + normaliserad beskrivning`.
6. Lokala CSV-filer flyttas till `data/finance/archive/<konto>` först efter lyckad DB-commit.

### Transaktionsfilter och summeringar

- Publikt API: `GET /api/finance/transactions` i `app/routers/finance.py`.
- Tillåtna filter skickas vidare till `list_transactions`, `count_transactions` och `sum_transactions` i `app/crud_finance.py`.
- `_apply_txn_filters` är den gemensamma källan för `account`, `category`, `typ`, `year`, datumintervall, textsökning, `exclude_overforing` och `max_amount`.
- `sum_amount` i API-svaret summerar samma filtrerade radmängd som `total`, men före `limit`/`offset`.
- `year` används bara när varken `date_from` eller `date_to` är satt.

### Dashboard

- `app/services/finance/dashboard.py` bygger `/api/finance/dashboard`, `/meta` och `/hero`.
- `dashboard` använder transaktionsliknande filter för aktivitetsgrafer och senaste transaktioner.
- Kontosaldon och kontotidslinje är ofiltrerade översikter baserade på senaste balansrad per konto.
- Diagram exkluderar `Överföring`, `Bostadsköp (engång)`, beskrivningar med `slutlikvid` och belopp över `chart_max_amount`.
- `hero` räknar tillgångar från senaste kontosaldon, skulder från `FinanceLoan` och nettoförmögenhet som tillgångar minus skulder.
