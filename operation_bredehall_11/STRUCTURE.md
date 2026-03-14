# Operation Bredehall 11 – Filstruktur

## Översikt

```
Operation Bredehall/
├── config.yaml              # Home Assistant add-on konfiguration
├── Dockerfile               # Container-build för HA
├── run.sh                   # Startscript (HA anropar detta)
├── requirements.txt         # Python-beroenden
├── STRUCTURE.md             # Denna fil
│
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI-app, routes (Hello World → sen full API)
│   ├── database.py          # SQLite-engine, session, init DB
│   ├── models.py            # SQLAlchemy-modeller (Task m.fl.)
│   ├── schemas.py           # Pydantic-modeller (API request/response) – Steg 2
│   ├── crud.py              # CRUD för uppgifter – Steg 2
│   │
│   ├── routers/             # API-routes uppdelade
│   │   ├── __init__.py
│   │   ├── tasks.py         # GET/POST/PUT/DELETE uppgifter
│   │   ├── filters.py      # Vyer: nästa månad, kvartal, år
│   │   └── calendar.py     # Google Calendar-export/synk
│   │
│   ├── services/
│   │   ├── __init__.py
│   │   ├── ai.py            # AI-assistent: analys + bidragssökning (OpenAI)
│   │   └── calendar_sync.py # Google Calendar API-anrop
│   │
│   └── seed/                # Startdata för svensk villa
│       ├── __init__.py
│       └── seed_tasks.py    # Script som fyller DB med standarduppgifter
│
├── frontend/                # (Steg 2) Statiska filer eller NiceGUI
│   ├── index.html
│   ├── static/
│   └── ...
│
└── tests/                   # (Valfritt) Enhetstester
    └── ...
```

## Steg 1 (nu)

- **config.yaml**, **Dockerfile**, **run.sh** – så att add-on startar och visar "Hello World".
- **app/database.py** – SQLite-setup, skapa tabeller.
- **app/models.py** – Tabellstruktur för uppgifter (titel, kategori, frekvens, datum, motivering, instruktioner).

## Steg 2 (nästa)

- **app/main.py** – Full FastAPI med routers, CORS, statisk frontend.
- **app/schemas.py**, **app/crud.py**, **app/routers/** – backend-logik och filtrering (nästa månad, kvartal, år).
- **frontend/** – Dashboard med Tailwind, vyer och uppgiftsdetaljer.

## AI-modul (arkitektur)

- **app/services/ai.py** anropas från **app/routers/** (t.ex. `routers/ai.py`).
- **Endpoints:**
  - `POST /api/ai/analyze-plan` – hämtar alla uppgifter från DB, skickar till LLM (OpenAI), returnerar analys + förslag. Frontend visar resultat och knapp "Lägg till förslag i databasen".
  - `POST /api/ai/search-grants` – LLM söker/sammanställer info om svenska bidrag (ROT, energieffektivisering, etc.). API-nyckel/config i add-on (config.yaml eller env).
- **Säkerhet:** API-nyckel lagras i HA add-on options, läsas som env i containern; anrop från frontend går via FastAPI så nyckeln aldrig exponeras.
