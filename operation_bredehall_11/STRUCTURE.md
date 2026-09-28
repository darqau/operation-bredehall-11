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

## Startsekvens

1. `run.sh`
   - Läser `/data/options.json` eller `/config/options.json`.
   - Exporterar `APP_API_KEY` om `app_api_key` är satt.
   - Startar `python3 -m uvicorn app.main:app --host 0.0.0.0 --port "$PORT"`.
2. `app.main.app`
   - Registrerar `ApiKeyMiddleware`.
   - Mountar `app/static` på `/static`.
   - Inkluderar routers för finance, tasks, calendar och AI.
3. `app.main.lifespan()`
   - Kör `sync_bundled_data()` innan databasen initieras.
   - Kör `init_db()` och `run_migrations(engine)`.
   - Seedar standarduppgifter/lån om databasen är tom.
   - Migrerar finance-konfiguration och historiska finance-rader.
   - Taggar interna överföringar och skriver statisk kategorilista för frontend.

## Runtime-data och sync

| Fil | Ansvar |
|-----|--------|
| `app/database.py` | Väljer `DATA_DIR`, bygger SQLite URL och skapar SQLAlchemy sessioner. |
| `app/data_sync.py` | Kopierar `bredehall.db` och `finance_config.json` från `/app/data` till `/data` i HA när SHA-256 skiljer sig. |
| `app/migrations.py` | Idempotenta schemaändringar och SQLite/WAL-inställningar. |
| `data/bredehall.db` | Canonical SQLite-data i git. |
| `data/finance_config.json` | Canonical finance-konfiguration i git. |
| `data/finance/` | Lokal CSV-inbox/archive, gitignored. |

Viktig konsekvens: HA-runtime (`/data`) är persistent, men git-bundlen vinner vid add-on-start om de två canonical-filerna skiljer sig. För ändringar som ska leva kvar efter uppdatering ska databasen/configen ändras lokalt och committas.

## API-lager

| Router | Prefix | Kodvägar |
|--------|--------|----------|
| `app/routers/tasks.py` | `/api/tasks` | CRUD, vyfilter, statistik och completions. |
| `app/routers/calendar.py` | `/api/calendar` | `.ics`-export från uppgifter med deadline. |
| `app/routers/finance.py` | `/api/finance` | Finance config, upload/process, dashboard, transaktioner, kategorier, AI och lån. |
| `app/routers/ai.py` | `/api/ai` | Underhålls-/planerings-AI separat från finance-AI. |

Auth ligger före routers i `app/middleware/auth.py`. När `APP_API_KEY` saknas är auth avstängd. När den är satt är `/`, `/health`, `/static/*` och `/api/auth/status` publika; övriga privata endpoints kräver `X-API-Key` eller `Authorization: Bearer`.

## Finance-moduler

| Fil | Roll |
|-----|------|
| `services/finance/config.py` | Läser/skriver `finance_config.json`, skapar inbox/archive-mappar och migrerar gamla kontonamn. |
| `services/finance/upload.py` | Sparar uploadade CSV-filer i rätt inbox. |
| `services/finance/detect.py` | Föreslår konto utifrån filnamn/innehåll och konfigurerade konton. |
| `services/finance/csv_parser.py` | Parser för svenska bank-CSV:er, datum, belopp, saldo och kodningar. |
| `services/finance/processor.py` | Läser inbox eller Google Drive, berikar rader, bulk-insertar och arkiverar lokala filer efter lyckad import. |
| `services/finance/categorizer.py` | Deterministisk typ-/kategoriregelmotor. |
| `services/finance/dashboard.py` | Aggregeringar, filter, grafserier, latest balances och nettoförmögenhet. |
| `services/finance/ai_finance.py` | OpenAI-kompatibel finance-AI för kategorier och låneparsning. |
| `crud_finance.py` | Dedup, filtrering, summering, kategoriuppdatering, intern överföringsdetektion och lån. |

Importkontrakt:

- CSV-rader dedupliceras bara för icke-manuella transaktioner.
- Fingerprint är konto + datum + belopp i ören + normaliserad description.
- Lokala filer flyttas från inbox till archive först när DB-inserten lyckats.
- Learned categories kommer från låsta transaktioner (`category_locked`) och matchar exakt description.
