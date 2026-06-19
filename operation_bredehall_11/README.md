# Operation Bredehall 11

Smart underhållsplanerare för villan som Home Assistant Custom Add-on.
Add-onen kör en FastAPI-app med statisk dashboard, SQLite-lagring,
standarduppgifter för svensk villa, kalenderexport och valfri AI-assistent.

**Webbgränssnitt:** [http://homeassistant.local:8765](http://homeassistant.local:8765)

Om `homeassistant.local` inte slår upp i ditt nätverk, använd Home Assistant-IP,
t.ex. `http://192.168.x.x:8765`.

---

## Funktioner

- Dashboard för att visa, skapa och ta bort underhållsuppgifter.
- Vyer för alla uppgifter, nästa månad, kommande kvartal och valt år.
- SQLite-databas i `/data/bredehall.db` i add-onen, med lokal fallback till
  `data/bredehall.db` vid utveckling utanför Home Assistant.
- Seed-data skapas vid första start om tabellen `tasks` är tom.
- iCalendar-export via `.ics` för import/prenumeration i kalenderappar.
- AI-assistent via OpenAI för plananalys, förslag och bidragsöversikt när
  API-nyckel är konfigurerad.

Se även [STRUCTURE.md](STRUCTURE.md) för fil- och modulöversikt.

---

## Installation i Home Assistant

1. Lägg till repositoryt som custom add-on-repository i Home Assistant:
   **Inställningar -> Tillägg -> Tilläggsbutik -> Repositories**.
2. Installera **Operation Bredehall 11**.
3. Kontrollera add-onens konfiguration:

   ```yaml
   port: 8765
   openai_api_key: ""
   google_calendar_credentials: ""
   ```

4. Starta add-onen och öppna webbgränssnittet på porten ovan.

### Konfigurationsnoteringar

- `port` används av `run.sh` när uvicorn startas. Standard är `8765`.
- `openai_api_key` är valfri. Utan nyckel fungerar dashboard, CRUD och
  kalenderexport, men AI-endpoints returnerar ett tydligt felmeddelande.
- `google_calendar_credentials` finns som option, men aktuell kalenderintegration
  är `.ics`-export från `/api/calendar/ical`; ingen Google Calendar-synk körs i
  koden i dag.

---

## Lokal utveckling

Kör från add-on-katalogen:

```bash
cd operation_bredehall_11
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8765
```

Öppna http://localhost:8765.

Vid lokal körning skapas databasen i `operation_bredehall_11/data/bredehall.db`
om `/data` inte finns. Sätt `DATA_DIR=/valfri/sokvag` för att styra platsen:

```bash
DATA_DIR="$PWD/data-dev" python -m uvicorn app.main:app --reload --port 8765
```

För att testa AI lokalt:

```bash
OPENAI_API_KEY="sk-..." python -m uvicorn app.main:app --reload --port 8765
```

---

## API-översikt

Alla datum skickas och returneras som ISO-format (`YYYY-MM-DD`).

### Uppgifter

| Metod | Sökväg | Beskrivning |
| --- | --- | --- |
| `GET` | `/api/tasks` | Lista uppgifter. Query: `view`, `year`. |
| `GET` | `/api/tasks/{task_id}` | Hämta en uppgift. |
| `POST` | `/api/tasks` | Skapa uppgift. |
| `PUT` | `/api/tasks/{task_id}` | Uppdatera angivna fält. |
| `DELETE` | `/api/tasks/{task_id}` | Ta bort uppgift. |

Tillåtna vyer för `GET /api/tasks?view=...`:

- tomt värde eller `all`: alla uppgifter
- `next_month`: uppgifter med deadline från i dag till ungefär nästa månad
- `next_quarter`: uppgifter med deadline inom cirka 92 dagar
- `this_year`: uppgifter mellan 1 januari och 31 december för `year` eller
  innevarande år

Exempel:

```bash
curl "http://localhost:8765/api/tasks?view=this_year&year=2026"
curl -X POST "http://localhost:8765/api/tasks" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Rensa hängrännor",
    "category": "Hus",
    "frequency": "Årlig",
    "next_deadline": "2026-10-15",
    "reason": "Minska risk för fuktskador",
    "description": "Rensa rännor och kontrollera nedfallsrör."
  }'
```

### Kalender

| Metod | Sökväg | Beskrivning |
| --- | --- | --- |
| `GET` | `/api/calendar/ical` | Exporterar alla uppgifter med `next_deadline` som heldagshändelser i `.ics`. |

Händelsens titel kommer från `title`; beskrivningen byggs av `reason` och
`description`. Uppgifter utan `next_deadline` exporteras inte.

### AI-assistent

| Metod | Sökväg | Beskrivning |
| --- | --- | --- |
| `POST` | `/api/ai/analyze-plan` | Skickar aktuell uppgiftslista till OpenAI och returnerar sammanfattning samt förslag. |
| `POST` | `/api/ai/add-suggestions` | Lägger till valda AI-förslag som nya uppgifter. |
| `POST` | `/api/ai/search-grants` | Ber OpenAI sammanställa svenska bidrag och skattereduktioner för husägare. |

AI-nyckeln läses i denna ordning:

1. miljövariabeln `OPENAI_API_KEY`
2. `/data/options.json`
3. `/config/options.json`

Nyckeln exponeras inte till frontend; webben anropar endast FastAPI.

---

## Datamodell

En uppgift (`Task`) innehåller:

- `id`
- `title`
- `category`
- `frequency`
- `last_done`
- `next_deadline`
- `reason`
- `description`
- `created_at`
- `updated_at`

Kategorier och frekvenser finns som enum-liknande värden i `app/models.py` och
används även av frontendens formulär. API:t validerar datatyper men begränsar
inte strängarna till enum-listorna, så klienter bör skicka samma värden som
dashboarden använder för konsekvent filtrering och visning.

---

## Felsökning

- **Webbgränssnittet öppnas inte:** kontrollera att add-onen kör, att porten är
  publicerad som `8765/tcp`, och prova Home Assistant-IP i stället för
  `homeassistant.local`.
- **AI-knapparna visar fel om API-nyckel:** lägg in `openai_api_key` i add-onens
  options eller sätt `OPENAI_API_KEY` lokalt och starta om appen.
- **Tom databas efter start:** seed-data skapas endast när tabellen `tasks` är
  tom. En befintlig databas seedas inte om automatiskt.
- **Kalenderexport saknar uppgifter:** endast uppgifter med `next_deadline`
  exporteras till `.ics`.
- **Lokal databas hamnar på oväntad plats:** appen använder `/data` om katalogen
  finns; annars skapas `data/bredehall.db` relativt add-on-katalogen. Sätt
  `DATA_DIR` för en explicit utvecklingsdatabas.
