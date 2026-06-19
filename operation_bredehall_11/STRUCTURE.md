# Operation Bredehall 11 - Filstruktur

Den här filen beskriver den aktuella add-on-arkitekturen. För installation,
API-exempel och felsökning, se [README.md](README.md).

## Repositorynivå

```
.
├── repository.yaml                 # Home Assistant repositorymetadata
└── operation_bredehall_11/
    ├── config.yaml                 # Add-on metadata, options, schema och portmappning
    ├── build.yaml                  # Base images per arkitektur för Supervisor-build
    ├── Dockerfile                  # Alpine-baserad Python/FastAPI-container
    ├── run.sh                      # Läser portoption och startar uvicorn
    ├── requirements.txt            # Python-beroenden
    ├── README.md                   # Användar- och utvecklardokumentation
    ├── STRUCTURE.md                # Denna fil
    └── app/
```

## Appstruktur

```
app/
├── __init__.py
├── main.py                         # FastAPI-app, lifespan, routerregistrering, statisk frontend
├── database.py                     # SQLite-engine, session dependency och persistent databasplats
├── models.py                       # SQLAlchemy-modell och värdelistor för Task
├── schemas.py                      # Pydantic request/response-modeller
├── crud.py                         # Databasoperationer och vyfilter
│
├── routers/
│   ├── __init__.py
│   ├── tasks.py                    # /api/tasks CRUD och filterparametrar
│   ├── calendar.py                 # /api/calendar/ical .ics-export
│   └── ai.py                       # /api/ai endpoints för analys, förslag och bidrag
│
├── services/
│   ├── __init__.py
│   └── ai.py                       # OpenAI-klient, prompts och felhantering
│
├── seed/
│   ├── __init__.py
│   └── seed_tasks.py               # Startdata för svensk villa vid tom databas
│
└── static/
    └── index.html                  # Tailwind-dashboard och frontendlogik
```

## Runtimeflöde

1. Home Assistant bygger add-onen från `Dockerfile` och `build.yaml`.
2. `run.sh` läser `port` från `/config/options.json` om filen finns, annars
   används `8765`, och startar `python3 -m uvicorn app.main:app`.
3. `app/main.py` kör lifespan-hooken:
   - `init_db()` skapar tabeller om de saknas.
   - `seed_if_empty()` lägger in standarduppgifter endast om `tasks` är tom.
4. FastAPI registrerar routrarna för uppgifter, kalender och AI.
5. `/` serverar `app/static/index.html`; `/static/*` serverar övriga statiska
   filer om sådana läggs till.

## Databas och persistence

- `app/database.py` använder SQLite med `check_same_thread=False`, vilket krävs
  för FastAPI/uvicorns trådmodell.
- Standardplats i add-onen är `/data/bredehall.db`, Home Assistants persistenta
  datavolym för add-ons.
- Vid lokal körning utan `/data` skapas `data/bredehall.db` i add-on-katalogen.
- Sätt miljövariabeln `DATA_DIR` för att använda en explicit databasplats vid
  utveckling eller felsökning.

## API-ansvar per modul

### `routers/tasks.py` och `crud.py`

- `GET /api/tasks` listar uppgifter sorterade på `next_deadline` och titel.
- `view` normaliseras så tom sträng behandlas som ingen vy.
- Stödda vyer: `next_month`, `next_quarter`, `this_year`, `all`.
- `POST`, `PUT` och `DELETE` använder `TaskCreate`/`TaskUpdate` från
  `schemas.py` och returnerar `TaskResponse`.

### `routers/calendar.py`

- `GET /api/calendar/ical` exporterar alla uppgifter med `next_deadline` som
  heldagshändelser.
- `UID` byggs av task-id och deadline.
- `title`, `reason` och `description` escapes för iCalendar-formatet.
- Det finns ingen aktiv Google Calendar API-synk i koden; exporten är en
  nedladdningsbar/prenumererbar `.ics`-fil.

### `routers/ai.py` och `services/ai.py`

- `POST /api/ai/analyze-plan` skickar uppgiftsöversikten till OpenAI och
  förväntar JSON med `summary` och `suggestions`.
- `POST /api/ai/add-suggestions` skapar nya uppgifter från valda förslag.
  Förslag får ingen `next_deadline` om klienten inte utökas med det fältet.
- `POST /api/ai/search-grants` ber OpenAI sammanställa svenska bidrag och
  skattereduktioner för husägare.
- API-nyckel hämtas från `OPENAI_API_KEY`, `/data/options.json` eller
  `/config/options.json`. Saknas nyckel returneras `{ "ok": false, ... }`
  istället för att dashboarden kraschar.

## Frontend

`app/static/index.html` är en fristående Tailwind-sida utan byggsteg.
Den använder `fetch` mot samma origin:

- laddar uppgifter och vyfilter från `/api/tasks`
- öppnar modal för detaljer och ny uppgift
- tar bort uppgifter via `DELETE /api/tasks/{id}`
- länkar direkt till `/api/calendar/ical`
- visar AI-resultat och kan skicka förslag till `/api/ai/add-suggestions`

Eftersom frontend ligger i containern behövs ingen separat `frontend/`-katalog
eller Node-baserad byggkedja i nuläget.
