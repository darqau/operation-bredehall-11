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

## Startsekvens

`app.main.lifespan()` kör samma ordning lokalt och i HA-containern:

1. `data_sync.sync_bundled_data()` kopierar bundlad `bredehall.db` och `finance_config.json` till `/data` i HA när hash skiljer sig.
2. `init_db()` skapar tabeller om de saknas.
3. `run_migrations(engine)` lägger till saknade kolumner och sätter SQLite/WAL-inställningar idempotent.
4. `seed_if_empty()` och `seed_loans_if_empty()` fyller bara tomma databaser.
5. Finansmigreringar i `_migrate_finance_on_startup()` uppdaterar gamla kontonamn, HA-optioner och kända kontokorrigeringar.
6. `_tag_internal_transfers_on_startup()` markerar historiska egna överföringar.
7. `_sync_finance_categories_static()` skriver `app/static/data/finance-categories.json` för frontendens kategorilista.

FastAPI monterar sedan routrarna `finance`, `tasks`, `calendar` och `ai`, och servar SPA:n från `app/static/`.

## Data

- **`bredehall.db`** + **`finance_config.json`** committas till git (privat repo)
- HA add-on: vid start kopieras bundlade filer till `/data` om innehållet skiljer sig (`DATA_DIR=/data` i Dockerfile)
- **Lokal utveckling:** alltid `operation_bredehall_11/data/` — `launch.py` sätter `DATA_DIR`; utan env används samma mapp automatiskt
- Använd **inte** `c:\data` på Windows (tidigare bugg — borttagen)
- Stoppa lokal server innan commit så databasen hinner stängas rent (se Inställningar i appen)

## API-ytor

| Router | Prefix | Viktiga vägar | Kommentar |
|--------|--------|---------------|-----------|
| `tasks.py` | `/api/tasks` | `GET/POST /`, `PUT/DELETE /{id}`, `POST /{id}/complete`, `/stats/summary`, `/completions` | Uppgifter, vyfilter (`next_month`, `next_quarter`, `this_year`, `overdue`, `all`) och slutförandelogg |
| `calendar.py` | `/api/calendar` | `/ical` | Exporterar uppgifter med deadline som heldags-VEVENTs; ingen Google Calendar API-synk |
| `ai.py` | `/api/ai` | `/analyze-plan`, `/add-suggestions`, `/search-grants` | Underhålls-AI, separat från ekonomi-AI |
| `finance.py` | `/api/finance` | `/config`, `/folders`, `/upload`, `/process`, `/dashboard`, `/transactions`, `/compare`, `/activity-log`, `/ai/*`, `/loans*` | Privatekonomi, import, analys, kategorisering och lån |

Auth hanteras globalt i `middleware/auth.py`. Utan `APP_API_KEY`/`app_api_key` är API:t öppet för lokal utveckling. Med nyckel krävs `X-API-Key` eller `Authorization: Bearer`, förutom publika vägar och HA Ingress-headern `X-Ingress-Path`.

## Ekonomimoduler

| Fil | Ansvar |
|-----|--------|
| `crud_finance.py` | Transaktioner, lån, dedup, filter, summeringar, inlärda kategorier och interna överföringar |
| `services/finance/config.py` | `finance_config.json`, konto-/mappdefaults, HA-option-synk och lokala inbox/archive-mappar |
| `services/finance/csv_parser.py` | Parser för bank-CSV med delimiter från konfig |
| `services/finance/detect.py` | Kontodetektering via filnamn, kontonummer och CSV-header/fält |
| `services/finance/upload.py` | Säker filnamnshantering och sparande till `data/finance/inbox/<konto>/` |
| `services/finance/processor.py` | Läser lokal inbox eller Google Drive, applicerar inlärda kategorier, skriver DB, arkiverar och loggar |
| `services/finance/dashboard.py` | Hero, dashboard, balansserier och konto-jämförelse |
| `services/finance/activity_log.py` | Import-/AI-/konto-/manuell transaktionshistorik |
| `services/finance/ai_finance.py` | OpenAI-kompatibel ekonomi-AI, batchkategorisering och lånetolkning |
| `services/finance/gdrive.py` | Valfri Google Drive-import och arkivflytt |

### Importdataflöde

```
CSV-upload eller inbox-fil
  → detect.detect_account()
  → upload.save_upload_to_inbox() eller processor.process_local_folders()
  → csv_parser.parse_bank_csv()
  → crud_finance.create_transactions_bulk()
  → activity_log.log_finance_activity()
  → lokal archive-flytt först efter lyckad DB-commit
```

Dubblettnyckeln finns i `crud_finance.transaction_fingerprint()`: konto, datum, belopp i ören och normaliserad beskrivning. `processor.process_bank_files()` kör `detect_internal_transfers()` efter import när nya rader lagts till. Google Drive-läge laddar ned filer via `gdrive.fetch_account_csvs()` och flyttar dem till Drive-arkivmappen om `archive_folder_id` är satt.

### Filter och diagram

`/api/finance/transactions` delar filterlogik för lista, total och `sum_amount` via `_apply_txn_filters()`. Stödda filter är konto/konton, kategori/kategorier, `flow`, `typ`, år eller datumintervall, söktext, överföringsexkludering och beloppscappar.

`dashboard.build_dashboard()` använder `year=None` som "alla år". Diagrammen exkluderar stora poster över `chart_max_amount`, `Bostadsköp (engång)` och beskrivningar med `slutlikvid`; svaret redovisar borttag i `chart_excludes`.

`dashboard.build_account_compare()` jämför två konton per månad. Valda inkomstkategorier gör jämförelsen positiv/income-baserad, rena utgiftskategorier gör den expense-baserad och blandade kategorier summeras utan teckenfilter.

## Operativa filer som inte ska committas

- `data/bredehall.db-wal`
- `data/bredehall.db-shm`
- `data/finance/` (CSV-inbox och archive)
- `__pycache__/`
- byggartefakter som `1.0.0/`
