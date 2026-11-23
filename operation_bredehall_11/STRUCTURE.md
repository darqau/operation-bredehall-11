# Operation Bredehall 11 – Filstruktur

## Översikt

```
operation_bredehall_11/
├── config.yaml              # HA add-on (direkt port 8765, app_api_key)
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

## Runtime-arkitektur

```text
Home Assistant
  config.yaml (port 8765, ingress false)
  └─ run.sh
      ├─ läser /data/options.json eller /config/options.json
      ├─ exporterar APP_API_KEY om app_api_key är satt
      └─ uvicorn app.main:app --host 0.0.0.0 --port <port>

Windows/lokal utveckling
  launch.py eller Start Bredehall.bat
      ├─ sätter DATA_DIR=<repo>/operation_bredehall_11/data
      ├─ hittar Python med uvicorn + multipart installerat
      └─ öppnar http://127.0.0.1:8890
```

`app.main` monterar statisk frontend från `app/static/`, lägger på
`ApiKeyMiddleware` och registrerar routrarna `finance`, `tasks`, `calendar`
och `ai`. Middleware släpper igenom publika paths (`/`, `/health`,
`/static/*`, auth/shutdown-status) samt HA Ingress-headers, men övriga API:er
kräver `X-API-Key` eller `Authorization: Bearer` när `APP_API_KEY` finns.

## Startup och dataflöde

```text
main.lifespan()
  ├─ data_sync.sync_bundled_data()
  │   └─ kopierar bredehall.db + finance_config.json från /app/data till /data
  │      när filernas SHA-256 skiljer sig
  ├─ init_db() + migrations.run_migrations()
  ├─ seed_tasks.seed_if_empty()
  ├─ seed_loans.seed_loans_if_empty()
  ├─ _migrate_finance_on_startup()
  │   ├─ migrate_legacy_config()
  │   ├─ sync_ha_options() läser HA-options men finance_config.json är källan
  │   └─ riktade historiska datamigreringar
  ├─ _tag_internal_transfers_on_startup()
  └─ _sync_finance_categories_static()
```

Viktig invariant: git-versionen av `data/bredehall.db` och
`data/finance_config.json` är canonical. HA:s persistenta `/data` uppdateras
från appens bundle på start om innehållet skiljer sig. CSV-arkiv,
Google-credentials, WAL/SHM och loggar ligger lokalt och ska inte committas.
Persisted `finance_config.json` styr `storage_mode`; HA-optionen
`finance_storage_mode` skriver inte över en befintlig fil.

## Finance-moduler

| Fil | Ansvar |
|-----|--------|
| `app/routers/finance.py` | HTTP-kontrakt för config, import, dashboard, transaktioner, kategorier, AI och lån. |
| `app/crud_finance.py` | Transaktions-CRUD, filter/count/sum, dedup-fingerprint, internöverföringar, kategorilås och låne-CRUD. |
| `app/services/finance/config.py` | Läser/skriver `finance_config.json`, skapar inbox/archive, mergear standardkonton och löser GDrive-credentials. |
| `app/services/finance/detect.py` | Kontodetektion via kontonummer, CSV-fält, filnamn och hints. |
| `app/services/finance/csv_parser.py` | Bank-CSV-parser. |
| `app/services/finance/processor.py` | Läser lokala/Drive-filer, väljer konto, skapar transaktioner, arkiverar och loggar aktivitet. |
| `app/services/finance/dashboard.py` | Aggregat för meta, hero, dashboard och kontojämförelse. |
| `app/services/finance/activity_log.py` | Persistens för import-/konto-/AI-logg. |
| `app/services/finance/ai_finance.py` | OpenAI-kompatibel batchkategorisering och låneparsing. |
| `app/services/finance/upload.py` | Säker filnamnshantering och konto-inboxar. |
| `app/services/finance/gdrive.py` | Drive-listning, nedladdning och valfri flytt till arkivmapp. |

### Import pipeline

```text
POST /api/finance/upload
  ├─ max 10 MB, UTF-8-SIG eller Latin-1
  ├─ detect_account() om account saknas
  ├─ create_account_folder() om nytt konto valts
  ├─ save_upload_to_inbox()
  └─ process_bank_files(trusted_keys={konto/fil}) när auto_process=true

POST /api/finance/process
  └─ process_bank_files()
      ├─ storage_mode=local: process_local_folders()
      │   ├─ okända filer blir unknown_files och lämnas kvar
      │   ├─ tydliga felkonton blir rerouted
      │   └─ lyckade filer flyttas till data/finance/archive/<konto>/
      └─ storage_mode=gdrive: process_gdrive()
          ├─ fetch_account_csvs()
          └─ flyttar Drive-fil till archive_folder_id om konfigurerat
```

Dedupen i `create_transactions_bulk()` läser befintliga icke-manuella rader
per konto och skippar samma `account + txn_date + amount_ore +
normaliserad description`. Manuella rader importeras alltid som separata
poster.

### Analys- och filterregler

- `GET /api/finance/transactions` delar filter mellan lista, `total` och
  `sum_amount`: konto/konton, kategori/kategorier, `flow`, `typ`, år,
  datumintervall, söktext, överföringsfilter och beloppscap.
- `GET /api/finance/dashboard` använder `year=None` som hela historiken.
  Grafdata exkluderar interna överföringar när parametern säger det,
  kategorierna `Överföring` och `Bostadsköp (engång)`, beskrivningar med
  `slutlikvid`, och belopp över `chart_max_amount`.
- `GET /api/finance/hero` räknar senaste bankrapporterade saldo per konto,
  skuldtotal från `FinanceLoan`, nettoförmögenhet och rullande 3/12-månaders
  snitt.
- `GET /api/finance/compare` jämför två konton månadsvis. Utan kategorier är
  flödet utgift; endast inkomstkategorier ger inkomstjämförelse, blandade
  kategorier ger mixed.

### Kategorisering

`PATCH /api/finance/transactions/{id}/category` sätter `category_locked` och
kan applicera kategorin på alla transaktioner med exakt samma beskrivning.
`processor.py` läser dessa låsta beskrivningar som "learned categories" före
ny CSV-import. Interna överföringar hittas genom matchande debit/credit-ben på
olika konton inom tre dagar och kräver dessutom textsignal eller träff i
`own_accounts_regex`.

### AI-gränser

Finance-AI läser `ai_enabled`, `ai_base_url`, `ai_api_key`, `ai_model`,
`ai_timeout_seconds` och `ai_batch_size` från `finance_config.json`, med
`FINANCE_AI_*` som fallback. Batchstorleken clampas till 1-30 och timeout till
60-1800 sekunder. Endpoints under `/api/finance/ai/*` kräver aktiverad AI och
låser granskade rader så kön inte fastnar på osäkra `Övrigt`-resultat.

Underhålls-AI under `/api/ai/*` är en separat router och använder
`openai_api_key` från HA-options.

## Frontend

Frontend är en statisk app:

```text
app/static/index.html
app/static/css/app.css
app/static/js/app.js
app/static/js/icons.js
app/static/vendor/
```

`app.js` håller globalt ekonomifilter-state, laddar API-nyckel från
`localStorage`, skickar den som `X-API-Key`, ritar grafer med vendorerad
Chart.js och använder samma finance-API:er som tabellerna. Kontojämförelse och
transaktionslistan delar inte exakt samma backend-endpoint; om UX-filter
ändras behöver både `/dashboard`/`/transactions` och `/compare` kontrolleras.

## Tester

Testerna ligger i `tests/` och använder temporär `DATA_DIR` via `conftest.py`.
De täcker bland annat auth, data-sync, CSV-parser/import/archive,
kontodetektion, transaktionsfilter/summor, account compare, dashboard/hero,
AI-logg, kategorilås och internöverföringar.
