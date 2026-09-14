# Operation Bredehall 11 - Filstruktur

## Översikt

```
operation_bredehall_11/
├── config.yaml              # Home Assistant add-on schema och port 8765
├── Dockerfile               # Bygger add-on-image och kopierar app + data
├── run.sh                   # Läser HA options och startar uvicorn
├── requirements.txt
├── requirements-dev.txt
├── README.md                # Användar-/driftsdokumentation
├── STRUCTURE.md             # Denna arkitekturöversikt
├── tests/                   # pytest för auth, data-sync, finance-regler
│
├── app/
│   ├── main.py              # FastAPI-app, routers och startup-lifespan
│   ├── data_sync.py         # Git-bundlad data -> /data i HA
│   ├── database.py          # SQLite engine, DATA_DIR och sessioner
│   ├── migrations.py        # Idempotenta SQLite-migrationer
│   ├── models.py            # SQLAlchemy-tabeller
│   ├── schemas.py           # Pydantic request/response-modeller
│   ├── crud.py              # Underhållsuppgifter och slutförandelogg
│   ├── crud_finance.py      # Transaktioner, lån, filter, dedup och kategorier
│   ├── middleware/auth.py   # Valfri API-nyckel för direkt port
│   │
│   ├── routers/
│   │   ├── tasks.py         # /api/tasks
│   │   ├── finance.py       # /api/finance
│   │   ├── calendar.py      # /api/calendar/ical
│   │   └── ai.py            # /api/ai (underhålls-AI)
│   │
│   ├── services/
│   │   ├── ai.py            # OpenAI-hjälp för underhållsplanen
│   │   └── finance/
│   │       ├── config.py    # finance_config.json, inbox/archive-mappar
│   │       ├── csv_parser.py
│   │       ├── detect.py    # Kontodetektering för uppladdad CSV
│   │       ├── processor.py # Local/GDrive importpipeline
│   │       ├── categorizer.py
│   │       ├── dashboard.py
│   │       ├── ai_finance.py
│   │       ├── gdrive.py
│   │       └── upload.py
│   │
│   ├── seed/                # Startdata om databasen är tom
│   └── static/              # Frontend-SPA och vendorfiler
│
└── data/
    ├── bredehall.db         # Canonical SQLite-databas i git
    ├── finance_config.json  # Canonical finanskonfig i git
    └── finance/             # Lokal CSV-inbox/archive, gitignored
```

## Startflöde

1. `run.sh` läser `port` och `app_api_key` från `/data/options.json` eller
   `/config/options.json` och exporterar `APP_API_KEY`.
2. `uvicorn app.main:app` startar på porten (standard `8765` i add-on).
3. `app.main.lifespan()` kör:
   - `sync_bundled_data()` före DB-init så HA:s `/data` får git-versionen.
   - `init_db()` och `run_migrations(engine)`.
   - seed av uppgifter/lån om tabellerna är tomma.
   - finansmigreringar och internöverförings-backfill.
   - skrivning av statisk kategorilista för frontend.
4. Routers monteras för finance, tasks, calendar och maintenance-AI.

## Data och synk

`app.database` väljer datamapp i denna ordning:

1. `DATA_DIR` om miljövariabeln är satt.
2. `/data` om katalogen finns (HA add-on).
3. Repositoryts `operation_bredehall_11/data/` för lokal utveckling.

`app.data_sync` kopierar bara `bredehall.db` och `finance_config.json`.
Kopiering sker när käll- och målhash skiljer och hoppas över när lokal dev redan
pekar på samma katalog. CSV-arkivet under `data/finance/` är lokalt arbetsdata
och ska inte committas.

## Auth-gräns

`ApiKeyMiddleware` är avstängd när ingen nyckel finns. När `APP_API_KEY` eller
HA-optionen `app_api_key` är satt släpps bara dessa igenom utan nyckel:

- `/`
- `/health`
- `/static/*`
- `/api/auth/status`
- requests med `X-Ingress-Path` (stöds i middleware, även om add-on kör med
  `ingress: false`)

Övriga anrop kräver `X-API-Key` eller `Authorization: Bearer`.

## Underhållsdomän

| Lager | Ansvar |
|-------|--------|
| `models.Task` | Uppgift med kategori, frekvens, deadline och metadata. |
| `models.TaskCompletion` | Historik när en uppgift markeras klar. |
| `crud.compute_next_deadline()` | Datumlogik för återkommande frekvenser. |
| `crud.get_tasks()` | Vyer: nästa månad, kvartal, år, försenat samt filtrering. |
| `routers/tasks.py` | HTTP-yta för CRUD, statistik och slutföranden. |
| `routers/calendar.py` | `.ics`-export av alla uppgifter med deadline. |

`En gång` och `Vid behov` får ingen automatisk nästa deadline.

## Finansdomän

### Tabeller

| Tabell | Syfte |
|--------|-------|
| `finance_transactions` | Importerade och manuella transaktioner. Viktiga fält: datum, belopp, saldo, konto, typ, kategori, källa, `category_locked`, `amount_ore`. |
| `finance_loans` | Manuellt underhållna lån/skulder, unika på `account_number`. |

### Konfiguration

`services/finance/config.py` skapar `finance_config.json` om den saknas, merge:ar
defaults utan att skriva över sparade mappar/kontonummer och säkerställer
`data/finance/inbox/<konto>`. HA-optionen `finance_storage_mode` appliceras bara
första gången filen skapas.

### Importpipeline

```
CSV upload eller inbox/GDrive
        |
        v
detect.py        # föreslå konto från filnamn, kontonummer och innehåll
csv_parser.py    # svenska datum/belopp, Nordea/Swedbank-lika headers
categorizer.py   # typ + kategori, inkl. internöverföringssignaler
crud_finance.py  # dedup och bulk insert
processor.py     # arkivera först efter lyckad insert
```

Viktiga invariants:

- Uploads begränsas till 10 MB i `routers/finance.py`.
- Dedup gäller importerade rader, inte manuella rader.
- Fingerprint = konto + datum + belopp i ören + normaliserad beskrivning.
- Lokala CSV-filer flyttas till archive först efter lyckad DB-insert.
- GDrive-import kan flytta filer till `archive_folder_id`, men importresultat
  returnerar även move-/authfel i `errors`.

### Filter och summeringar

`crud_finance._apply_txn_filters()` används gemensamt av lista, antal och summa.
Det gör att `/api/finance/transactions` returnerar `total` och `sum_amount` med
samma filter som `items` före pagination.

Delade filter: `account`, `category`, `typ`, `year`, `date_from`, `date_to`,
`search`, `exclude_overforing`, `max_amount`. Datumintervall går före `year`.

Dashboard använder samma filter för transaktioner men beräknar kontobalanser
från senaste saldo per konto över hela databasen. Grafserier exkluderar stora
engångsposter via `chart_max_amount` och fasta kategorier i
`services/finance/dashboard.py`.

### Kategorier och AI

- Regelmotorn i `categorizer.py` är primär och körs vid import.
- Manuella ändringar via `PATCH /transactions/{id}/category` sätter
  `category_locked=True`.
- `apply_to_similar=true` uppdaterar rader med exakt samma beskrivning.
- Nya importer får låst kategori om beskrivningen matchar en befintlig låst rad.
- Internöverföringar kan detekteras via två motsatta rader på olika konton inom
  tre dagar, men kräver textsignal/regex för att undvika falska träffar.
- Finans-AI i `ai_finance.py` arbetar batchvis mot OpenAI-kompatibla endpoints
  och applicerar bara kategorier som inte är `Övrigt`.

Maintenance-AI (`services/ai.py`) och finans-AI (`services/finance/ai_finance.py`)
har separata konfigurationsvägar.

## Testtäckning

Aktuell testsuite täcker bland annat:

- API-key auth och Ingress-bypass.
- Git-bundlad data-sync till runtime-mapp.
- CSV-parser för svenska bankexporter.
- Arkivering först efter lyckad DB-import.
- Dedup med öresbelopp/fingerprint.
- Internöverföringar, el-/bolånekategorier och sorterad kategorilista.
- Låsta kategorier och "applicera på liknande".
- Senaste saldo per konto i dashboard.

Kör:

```bash
cd operation_bredehall_11
pytest tests/ -q
```
