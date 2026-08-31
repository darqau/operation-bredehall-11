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

## Startflöde och drift

1. `run.sh` läser Home Assistant options och startar uvicorn på konfigurerad port.
2. `app.main.lifespan()` kör vid boot:
   - `data_sync.sync_bundled_data()` kopierar git-versionen av `bredehall.db` och `finance_config.json` till `/data` i HA när filhash skiljer.
   - `init_db()` och `run_migrations(engine)` skapar/uppgraderar SQLite-schemat idempotent.
   - seed-data för uppgifter och lån skapas om tabellerna är tomma.
   - finansmigreringar normaliserar äldre konto-/kategori-data och märker interna överföringar.
   - kategorilistan skrivs till `app/static/data/finance-categories.json` för frontend.
3. `ApiKeyMiddleware` skyddar API:er när `APP_API_KEY`/`app_api_key` är satt. `/`, `/health`, `/static/*` och `/api/auth/status` är publika; `X-Ingress-Path` bypass:ar eftersom HA redan autentiserat.

## Ekonomi: kodvägar

| Område | Kod | Kontrakt |
|--------|-----|----------|
| Konfiguration | `services/finance/config.py` | Läser/skriver `data/finance_config.json`, skapar inbox/archive-mappar, migrerar gamla kontonamn och seedar exempelvärden utan att skriva över befintliga Drive-id:n. |
| CSV-parser | `services/finance/csv_parser.py` | Tolkar svenska datum/belopp, hittar rubrikrad inom de första raderna och mappar bankkolumner till `txn_date`, `amount`, `description`, `balance`, `sender`, `receiver`, `currency`. |
| Import | `services/finance/processor.py` | Väljer `local` eller `gdrive`, applicerar lärda kategorier, klassar rader, bulk-insertar och arkiverar lokala CSV-filer först efter lyckad DB-skrivning. |
| Transaktions-CRUD | `crud_finance.py` | Deduplicerar importerade rader via konto/datum/ören/beskrivning, delar filter mellan lista/count/summa, hanterar kategori-lås och lån. |
| Dashboard | `services/finance/dashboard.py` | Bygger saldon, tidsserier, topplistor och hero-mått. Tabellfilter påverkar summeringar; saldon är alltid senaste kända per konto. |
| Kategorisering | `services/finance/categorizer.py` | Regelbaserad `typ` + kategori. `own_accounts_regex` hjälper men parning av lika stora debit/credit-rader krävs för säkrare interna överföringar. |
| AI ekonomi | `services/finance/ai_finance.py` | OpenAI-kompatibel klient för batch-kategorisering och lån-/bildtolkning. Resultat måste vara JSON och kategorier måste finnas i `CATEGORIES`. |
| API-router | `routers/finance.py` | Exponerar `/api/finance/config`, `/upload`, `/process`, `/dashboard`, `/transactions`, `/ai/*`, `/loans*` och kategoriändringar. |

### Filter- och summainvariant

`/api/finance/transactions` använder samma filterfunktion för `items`, `total` och `sum_amount`:

- konto, kategori, typ
- år om inget explicit datumintervall är satt
- `date_from`/`date_to`
- beskrivningssökning med escapade SQL LIKE-wildcards
- `exclude_overforing`
- `max_amount` som absolutbelopp

Det betyder att frontend kan visa en paginerad tabell och ändå använda `sum_amount` som totalsumma för hela den filtrerade mängden. Ändra därför filter i `crud_finance._apply_txn_filters()` när listning, räkning och summa ska fortsätta vara konsekventa.

### Import- och arkivinvariant

Lokala CSV-filer flyttas från `data/finance/inbox/<konto>/` till `data/finance/archive/<konto>/` bara efter att `create_transactions_bulk()` har lyckats. Om DB-skrivningen kastar undantag returnerar importen `ok: false`, rapporterar felet och lämnar filerna i inboxen för ny körning. Test: `tests/test_processor_archive.py`.

### Dashboard-exkluderingar

Dashboarden räknar transaktioner med samma filter som tabellen, men diagrammen döljer brus separat:

- `Överföring` om `exclude_overforing=true`
- kategorierna `Överföring` och `Bostadsköp (engång)`
- beskrivningar som innehåller `slutlikvid`
- belopp vars absolutvärde är större än `chart_max_amount`

Det här påverkar tidsserierna, inte nödvändigtvis transaktionslistans `items` eller `sum_amount`.
