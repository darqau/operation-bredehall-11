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

1. Home Assistant startar `run.sh`.
2. `run.sh` läser `/data/options.json` eller `/config/options.json`, exporterar
   `APP_API_KEY` om `app_api_key` finns och startar uvicorn.
3. `app.main.lifespan()` kör vid boot:
   - `data_sync.sync_bundled_data()` kopierar `bredehall.db` och
     `finance_config.json` från `/app/data` till `/data` när filhash skiljer sig.
   - `init_db()` och `run_migrations(engine)` skapar/uppgraderar tabeller.
   - `seed_if_empty()` och `seed_loans_if_empty()` fyller bara tomma databaser.
   - Finance-config migreras, `finance_config.json` får styra lagringsläge när
     filen finns, historiska finance-migreringar körs och interna överföringar
     backfylls.
   - `app/static/data/finance-categories.json` skrivs från aktuell kategorilista.
4. Routrar monteras för finance, tasks, calendar och AI; statiska filer serveras
   från `app/static/`.

## Runtime och API-ytor

| Modul | Ansvar |
|-------|--------|
| `app/main.py` | FastAPI-app, startup-lifecycle, statiska filer, health/auth/shutdown-status. |
| `app/middleware/auth.py` | Valfri API-nyckel. Publikt: `/`, `/health`, `/static/*`, `/api/auth/status`, `/api/shutdown/status`. |
| `app/routers/tasks.py` | Uppgifter, statistik, completion-logg. |
| `app/routers/calendar.py` | `.ics`-export av deadlines via `/api/calendar/ical`. |
| `app/routers/ai.py` | Underhålls-AI (`/api/ai/*`) som använder `openai_api_key`/OpenAI-service. |
| `app/routers/finance.py` | Finance-config, import, filters, dashboard, jämförelse, aktivitetslogg, kategorier, AI och lån. |

Det finns två AI-ytor:

- `/api/ai/*` analyserar underhållsplanen och bidrag.
- `/api/finance/ai/*` kategoriserar transaktioner och tolkar lån via
  OpenAI-kompatibel endpoint från `finance_config.json`.

## Data

- **`bredehall.db`** + **`finance_config.json`** committas till git (privat repo)
- HA add-on: vid start kopieras bundlade filer till `/data` om innehållet skiljer sig (`DATA_DIR=/data` i Dockerfile)
- **Lokal utveckling:** alltid `operation_bredehall_11/data/` — `launch.py` sätter `DATA_DIR`; utan env används samma mapp automatiskt
- Använd **inte** `c:\data` på Windows (tidigare bugg — borttagen)
- Stoppa lokal server innan commit så databasen hinner stängas rent (se Inställningar i appen)

Committa:

- `data/bredehall.db`
- `data/finance_config.json`

Committa inte:

- `data/bredehall.db-wal`, `data/bredehall.db-shm`
- `data/finance/` (lokalt CSV-inbox/archive)
- `__pycache__`, byggartefakter

## Finance-moduler

| Fil | Ansvar |
|-----|--------|
| `services/finance/config.py` | `finance_config.json`, inbox/archive-mappar, lokalt/gdrive-läge, konto- och AI-inställningar. |
| `services/finance/upload.py` | Säker filnamnshantering, unika uploadnamn och skapande av konto-mappar. |
| `services/finance/detect.py` | Kontodetektering från filnamn, kontonummer och CSV-fält. |
| `services/finance/csv_parser.py` | Bank-CSV till normaliserade rader. |
| `services/finance/processor.py` | Import från lokala mappar eller Google Drive, dedup, arkivering, aktivitetslogg. |
| `services/finance/categorizer.py` | Regelbaserad kategori/typ och sorterad kategorilista. |
| `services/finance/dashboard.py` | Hero, grafer, kontojämförelse, belopps-/chart-exkluderingar. |
| `services/finance/ai_finance.py` | Batchad AI-kategorisering, reviewed queue och lånetolkning. |
| `services/finance/activity_log.py` | Läsning och serialisering av finance-händelser. |
| `crud_finance.py` | Transaktions-/låne-CRUD, filter, summering, dubblettfingerprint, låsta kategorier. |

### Importflöde

```text
CSV upload eller data/finance/inbox/<konto>/
  -> detect_account()
  -> process_bank_files()
  -> parse_bank_csv()
  -> apply_learned_category() + enrich_transaction()
  -> create_transactions_bulk()
  -> data/finance/archive/<konto>/ (endast efter lyckad lokal DB-insert)
  -> finance_activity_log
```

Viktiga invariants:

- Dedup gäller bara icke-manuella rader och använder
  `(account, txn_date, amount_ore, normalized_description)`.
- `GET /api/finance/transactions` använder samma filter för lista, `total` och
  `sum_amount` innan `limit`/`offset`.
- Datumintervall (`date_from`/`date_to`) vinner över `year`.
- `chart_max_amount` används som beloppstak när det skickas; annars används
  `max_amount`.
- `chart_exclusions=true` exkluderar `Bostadsköp (engång)` och beskrivningar
  som innehåller `slutlikvid`.
- Interna överföringar kan backfyllas vid start och manuellt via
  `POST /api/finance/detect-transfers`.
- `POST /api/finance/recategorize?method=rules` är avsedd att köra regler igen;
  verifiera importen av `recategorize_rules` innan du lutar drift mot den
  endpointen.

## Frontend

`app/static/index.html` är en serverad SPA med mörkt tema i `css/app.css` och
applogik i `js/app.js`.

- Sidebar är fast på desktop och off-canvas på mobil.
- Finance-sidan har globalt filterläge och kontojämförelseläge. Senast aktiv
  källa styr transaktionstabellen; UI:t visar om tabellen kommer från
  "Globalfilter" eller "Jämförelse".
- Filterpanelen stödjer konto, kategori, år/eget datumintervall, sök, interna
  överföringar och beloppstak. Kontojämförelsen kan sätta eget intervall eller
  välja månad från grafen.
- `static/data/finance-categories.json` genereras vid startup för att frontend
  även ska ha kategorier när API-cache eller statiska resurser ligger efter.

## Tester och var de säkrar beteende

| Test | Täcker |
|------|--------|
| `test_auth.py` | API-key/public paths. |
| `test_data_sync.py` | Hashbaserad git-data -> `/data`-synk. |
| `test_processor_import.py`, `test_processor_archive.py` | CSV-import, arkiv och importresultat. |
| `test_account_detect.py`, `test_internal_transfers.py` | Kontodetektering och interna överföringar. |
| `test_transaction_category_filter.py`, `test_account_compare.py` | Finance-filter, summering och kontojämförelse. |
| `test_activity_log.py`, `test_ai_activity_log.py` | Aktivitetslogg för import/manuell/AI. |
| `test_ai_finance.py`, `test_learned_category.py`, `test_similar_category.py` | AI-kategorisering, låsta kategorier och apply-to-similar. |
