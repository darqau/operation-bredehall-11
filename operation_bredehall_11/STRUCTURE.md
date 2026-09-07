# Operation Bredehall 11 – Filstruktur

## Översikt

```
operation_bredehall_11/
├── config.yaml              # HA add-on (direkt port, app_api_key)
├── Dockerfile
├── run.sh                   # Start uvicorn, läser HA options
├── requirements.txt
├── requirements-dev.txt     # pytest, httpx
├── README.md
├── tests/                   # pytest-grundsuite
│
├── app/
│   ├── main.py              # FastAPI, auth middleware, startup/data hooks
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
│   ├── services/finance/    # import, dashboard, kategorisering, AI, config
│   ├── seed/
│   └── static/              # SPA (index.html, app.js, vendor/)
│
└── data/                    # I git: bredehall.db + finance_config.json
                             # Lokalt gitignored: finance/ CSV-arkiv
```

## Data

- **`bredehall.db`** + **`finance_config.json`** committas till git (privat repo)
- HA add-on: vid start kopieras bundlade filer från `/app/data` till `/data` om SHA-256 skiljer sig
- Lokal dev läser/skriver samma `data/`-mapp — ingen separat databas
- Stoppa lokal server och kör `PRAGMA wal_checkpoint(TRUNCATE)` innan commit av databasen
- Committa inte SQLite-WAL/SHM, CSV-arkivet i `data/finance/`, `__pycache__` eller `1.0.0`

Startup-ordningen finns i `app.main.lifespan()`:

1. `app.data_sync.sync_bundled_data()` synkar `bredehall.db` och `finance_config.json` i HA-containern.
2. `init_db()` och `run_migrations(engine)` säkerställer schema.
3. Seed körs bara om tabellerna är tomma.
4. Finansmigreringar och internöverföringsdetektion körs idempotent.

## HTTP och auth

- `run.sh` läser HA options från `/data/options.json` eller `/config/options.json` och exporterar `APP_API_KEY`.
- `config.yaml` exponerar port `8765`; Ingress är avstängt (`ingress: false`).
- `app.middleware.auth.ApiKeyMiddleware` kräver nyckel på privata API:er när `APP_API_KEY` finns.
- Publika vägar: `/`, `/health`, `/static/*`, `/api/auth/status`.
- Godkända klientheaders: `X-API-Key: <nyckel>` eller `Authorization: Bearer <nyckel>`.

## Ekonomi

### Router och service-lager

| Kod | Ansvar |
|-----|--------|
| `app/routers/finance.py` | HTTP-kontrakt för config, import, dashboard, transaktioner, kategorier, AI och lån |
| `app/crud_finance.py` | SQLAlchemy-frågor, deduplicering, kategorilås, lån och transaktionssummeringar |
| `app/services/finance/processor.py` | Läser inbox-mappar, parser CSV och arkiverar lyckade filer |
| `app/services/finance/csv_parser.py` | Bank-CSV → normaliserade transaktionsrader |
| `app/services/finance/categorizer.py` | Regelbaserad `typ`/kategori och sorterad kategorilista |
| `app/services/finance/dashboard.py` | Aggregeringar för dashboard, grafer, saldo och nettoförmögenhet |
| `app/services/finance/config.py` | `data/finance_config.json`, HA-option sync och kontomappning |
| `app/services/finance/ai_finance.py` | Valfri OpenAI-kompatibel kategorisering och lånetolkning |

### Transaktionsfilter

`GET /api/finance/transactions` använder `crud_finance._apply_txn_filters()` för listning, `total` och `sum_amount`. Det innebär att summeringen följer samma filter som listan men räknas före `limit`/`offset`.

Filter som delas av listan och dashboarden:

- `account`, `category`, `typ`
- `year` när explicit datumintervall saknas
- `date_from`, `date_to`
- `search` i beskrivning där SQL LIKE-wildcards escapats
- `exclude_overforing`
- `max_amount` som absolutbeloppsgräns

Sortering i transaktionslistan är begränsad till `txn_date`, `amount`, `description`, `account` och `category`; `limit` är `1..500`.

### Dashboard-kontrakt

`app.services.finance.dashboard.build_dashboard()` använder samma basfilter men har separata grafregler:

- `year=None` betyder alla år.
- Bankbalanser hämtas från senaste balance-raden per konto och är ofiltrerade översiktsvärden.
- Grafer exkluderar alltid kategorierna `Överföring` och `Bostadsköp (engång)`, beskrivningar som innehåller `slutlikvid`, samt rader över `chart_max_amount`.
- Diagramserier dedupliceras på datum, avrundat belopp och normaliserad beskrivning.

`build_hero()` räknar aktuella tillgångar från senaste kontosaldon, skulder från `FinanceLoan` och nettoförmögenhet som tillgångar minus skulder.
