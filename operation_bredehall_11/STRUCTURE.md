# Operation Bredehall 11 – Filstruktur

## Översikt

```
operation_bredehall_11/
├── config.yaml              # HA add-on (direkt port 8765, app_api_key, options)
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

### Startsekvens

1. `run.sh` läser `/data/options.json` eller `/config/options.json`, exporterar `APP_API_KEY` och startar uvicorn.
2. `app.main.lifespan()` kör `sync_bundled_data()` innan DB-init så git-versionen av `bredehall.db` och `finance_config.json` vinner i HA-containern.
3. `init_db()` skapar saknade tabeller och `run_migrations()` sätter SQLite WAL samt idempotenta kolumnmigreringar.
4. Seed körs för uppgifter/lån om databasen är tom.
5. Finance-startup migrerar äldre kontonamn, läser/skapar `finance_config.json`, märker interna överföringar och skriver statisk kategorilista till `app/static/data/finance-categories.json`.

## API- och modulägarskap

| Område | API/router | Implementation |
|--------|------------|----------------|
| Uppgifter | `app/routers/tasks.py` | `app/crud.py`, `app/models.py`, `app/schemas.py` |
| Kalender | `app/routers/calendar.py` | `.ics`-export av tasks med `next_deadline` |
| Underhålls-AI | `app/routers/ai.py` | `app/services/ai.py`, add-on option `openai_api_key` |
| Ekonomi | `app/routers/finance.py` | `app/crud_finance.py`, `app/services/finance/*` |
| Auth | middleware i `app/main.py` | `app/middleware/auth.py`, `APP_API_KEY`/`app_api_key` |
| Statisk UI | `/` och `/static/*` | `app/static/index.html`, `app/static/js/app.js`, `app/static/css/app.css` |

## Finance-moduler

```
app/services/finance/
├── config.py        # finance_config.json, inbox/archive, HA option fallback
├── upload.py        # säker filnamnshantering, konto-/inbox-skapande
├── detect.py        # kontodetektion via filnamn, CSV-fält, kontonummer och hints
├── csv_parser.py    # bank-CSV -> normaliserade transaktionsrader
├── processor.py     # local/GDrive-import, arkivering, aktivitetslogg
├── dashboard.py     # hero, dashboard, kontojämförelse, chart-exkluderingar
├── categorizer.py   # regelbaserad typ/kategori + kategorisortering
├── ai_finance.py    # OpenAI-kompatibel finance-AI och lånetolkning
├── activity_log.py  # persistens för import-/AI-/kontoaktivitet
└── gdrive.py        # valfri Google Drive-läsning/flytt till arkivmapp
```

Viktiga invariants:

- Local mode läser `data/finance/inbox/<konto>/*.csv` och flyttar bara till `data/finance/archive/<konto>/` efter lyckad DB-insert.
- GDrive mode laddar ner CSV från `folder_map` och flyttar Drive-filer till `archive_folder_id` om det är satt.
- Import-dedup sker i `crud_finance.transaction_fingerprint()` på konto, datum, belopp i öre och normaliserad beskrivning. Manuella rader dedupliceras inte mot bankimport.
- `get_learned_categories()` lär kategori från låsta rader (`category_locked`) med exakt beskrivningsmatch.
- `detect_internal_transfers()` använder `own_accounts_regex` för att märka interna överföringar som `Överföring`.
- Dashboardens chart-filter tar bort `Överföring` när flaggan är satt, kategorin `Bostadsköp (engång)`, beskrivningar med `slutlikvid` och belopp över `chart_max_amount`.
- `/api/finance/transactions` delar samma filter för lista, `total` och `sum_amount`; `limit`/`offset` påverkar bara listan.

## Frontend-flöden

`app/static/js/app.js` håller klienttillstånd för:

- `financeFilters` — globalt konto/period/kategori/typ/sök/belopp/sortering.
- `compareView` — tvåkontosjämförelse, vald månad/intervall, vald kategori och transfer-toggle.
- `txnViewSource` — avgör om transaktionstabellen följer globalfilter eller jämförelsefilter.

När jämförelse är aktiv byggs transaktionsfrågan med `accounts`, `flow`, `chart_exclusions=true` och datum från vald månad/intervall. När globalfilter är aktivt byggs frågan från sidofiltret; egna datum vinner över år.

## Testkarta

Relevanta regressionstester finns i `tests/`:

- Auth och publika vägar: `test_auth.py`
- Data-sync till HA-volym: `test_data_sync.py`
- CSV-import, arkivering och dedup: `test_processor_import.py`, `test_processor_archive.py`, `test_fingerprint.py`
- Kontodetektion och interna överföringar: `test_account_detect.py`, `test_internal_transfers.py`
- Finance-filter, dashboard och jämförelse: `test_transaction_category_filter.py`, `test_dashboard_balance.py`, `test_account_compare.py`, `test_hero_category_averages.py`
- Kategorier och liknande rader: `test_category_sort.py`, `test_category_stats.py`, `test_learned_category.py`, `test_similar_category.py`
- Aktivitetslogg och finance-AI: `test_activity_log.py`, `test_ai_activity_log.py`, `test_ai_finance.py`
