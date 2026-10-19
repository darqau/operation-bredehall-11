# Operation Bredehall 11

Smart underhållsplanerare och privatekonomi för villan — Custom Add-on för Home Assistant.

## Öppna appen

| Väg | URL | Auth |
|-----|-----|------|
| **Direkt port (LAN/Tailscale)** | `http://<host>:8765` | API-nyckel (`app_api_key` i add-on-konfig) |
| **Från Home Assistant** | Add-on → **Öppna webbgränssnittet** | Samma som ovan |

**Tailscale (mobil):** `http://<HA Tailscale-IP>:8765` — t.ex. `http://100.x.x.x:8765`. Ange API-nyckeln under **Inställningar** i appen första gången.

Add-on använder **egen port** (som Trafik-Dashboard), inte HA Ingress.

Lokal utveckling utan API-nyckel (läser/skriver `data/` i denna mapp):

```bash
cd operation_bredehall_11
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8890
```

Alternativt: **`Start Bredehall.exe`** sätter `DATA_DIR` automatiskt till `./data`.

Öppna http://127.0.0.1:8890 — ingen nyckel krävs om `APP_API_KEY` inte är satt.

**Windows:** dubbelklicka **`Start Bredehall.exe`** (eller `Start Bredehall.bat`) i `operation_bredehall_11/`. Exe öppnar samma cmd-fönster som .bat och startar servern. Webbläsaren öppnas automatiskt. Stäng via **Stäng** i appen eller stäng konsolfönstret.

**Bygg om exe** (`build_launcher.bat`) bara om du ändrat **`launch.py`** (port, webbadress, Python-sökning). Appkod, databas och UI kräver inte ny exe — bara omstart av servern.

## Säkerhet

- Sätt **`app_api_key`** i add-on options vid exponering via Tailscale eller öppen port.
- Webbläsaren sparar nyckeln i `localStorage` (fält under Inställningar).
- Add-on körs på **port 8765** — ingen Ingress-proxyn.
- Mass-radering av transaktioner (`DELETE /api/finance/transactions`) är borttagen; dev-wipe kräver `ALLOW_WIPE=1`.

## Funktioner

- Underhållsuppgifter med vyer, deadline och `.ics`-export
- Ekonomi: CSV-import, kategorisering (regler + valfri lokal AI), grafer, bolån/skulder
- Kategorisida med inline-redigering

## Arkitektur i korthet

Add-onen kör en FastAPI-app som serverar både API och den statiska SPA:n i
`app/static/`. Home Assistant startar `run.sh`, som läser `port` och
`app_api_key` från add-on options och exponerar uvicorn på `0.0.0.0:8765`.

Auth är avsiktligt enkel:

- Om `app_api_key` är tomt krävs ingen nyckel (lokal utveckling).
- Om nyckeln är satt kräver alla API:er utom publika paths antingen
  `X-API-Key: <nyckel>` eller `Authorization: Bearer <nyckel>`.
- Publika paths är `/`, `/health`, `/static/*`, `/api/auth/status` och
  `/api/shutdown/status`.
- `X-Ingress-Path` accepteras av middleware, men add-on-manifestet har
  `ingress: false`; normal åtkomst är direkt port/LAN/Tailscale.

## Data — en databas, samma överallt

All data (uppgifter, transaktioner, lån) ligger i **`data/bredehall.db`**. Filen ligger i git tillsammans med **`data/finance_config.json`**. Det är den enda källan — du behöver inte importera CSV igen när Home Assistant uppdateras.

| Var du öppnar appen | Vad som händer |
|---------------------|----------------|
| **Datorn** (`127.0.0.1:8890`) | Läser `data/bredehall.db` direkt |
| **Home Assistant / Tailscale** (`:8765`) | Får samma fil från git vid omstart (automatisk kopiering om innehållet skiljer sig) |

### Rutin efter ändringar

1. Gör ändringar lokalt på datorn.
2. **Stoppa** den lokala servern (Ctrl+C) innan du sparar till git. Medan appen kör håller den databasen öppen — då riskerar git att missa det senaste. Tillfälliga sidofiler (`.db-wal`, `.db-shm`) försvinner när servern stoppats och allt skrivits in i huvudfilen.
3. Om du är osäker på att WAL är tömd, kör:

   ```bash
   python -c "import sqlite3; c=sqlite3.connect('data/bredehall.db'); c.execute('PRAGMA wal_checkpoint(TRUNCATE)'); c.close()"
   ```

4. Commit och push (`data/bredehall.db` + `data/finance_config.json`).
5. Home Assistant: uppdatera add-on → **Återuppbygg** → **Starta om**.

**OBS:** Ändringar du bara gör via mobil/Tailscale följer inte med till git automatiskt. Gör ekonomiändringar på datorn om de ska sparas i repot.

CSV-arkivet (`data/finance/`) stannar på datorn (gitignored) — transaktionerna finns redan i databasen.

Repot innehåller riktig ekonomidata — håll det **privat** på GitHub.

## Konfiguration

- **`data/finance_config.json`** — konton, kontonummer, mappar, lagringsläge och
  finance-AI (följer med i git).
- `storage_mode` kan vara `local` eller `gdrive`. I praktiken styrs läget av
  `finance_config.json`; ändra i appens Inställningar eller direkt i filen.
  Förlita dig inte på att HA-optionen `finance_storage_mode` skriver över en
  befintlig config.
- Google Drive-import är valfri och kräver service-account credentials via
  `gdrive_credentials_path`, `GDRIVE_CREDENTIALS_PATH` eller
  `data/gdrive_credentials.json`.
- Kalenderintegration är `.ics`-export på `/api/calendar/ical`; värdet
  `google_calendar_credentials` i `config.yaml` startar ingen Google Calendar
  API-synk.

## Ekonomiflöde

### Import av CSV

1. Lägg bankfiler i `data/finance/inbox/<konto>/` eller ladda upp dem i appen.
2. `POST /api/finance/detect` kan förhandsvisa kontodetektering. Detektion väger
   filnamn, kontonummer i filnamn/avsändare/mottagare och CSV-header.
3. `POST /api/finance/upload` sparar filen i rätt inbox och kör import direkt som
   standard (`auto_process=true`).
4. `POST /api/finance/process` importerar alla väntande CSV:er.
5. Lyckade lokala importer flyttas till `data/finance/archive/<konto>/`.

Importen hoppar över dubbletter med fingeravtrycket
`konto + datum + belopp i öre + normaliserad beskrivning`. Manuella rader är
undantagna från den dubblettkontrollen. Om kontot kan avgöras säkert kan en fil
automatiskt flyttas till ett annat konto; osäkra filer lämnas kvar och returneras
i `unknown_files`.

### Kategorisering och jämförelse

- Regler och `own_accounts_regex` sätter typ/kategori och märker interna
  överföringar som `Överföring`.
- När en kategori ändras via UI/API låses raden (`category_locked=true`).
  `apply_to_similar=true` låser samma exakta beskrivning.
- Finance-AI finns under `/api/finance/ai/*` och använder en OpenAI-kompatibel
  endpoint från `finance_config.json`. Standard är lokal LM Studio
  (`http://localhost:1234/v1`), batchstorlek 5 och timeout 300 s.
- Kontojämförelse (`/api/finance/compare`) jämför två konton över senaste
  månader, valt år eller eget datumintervall. Transaktionstabellen kan visa
  antingen globalfilter eller jämförelsens filter.

### Viktiga finance-API:er

| Endpoint | Syfte / constraints |
|----------|---------------------|
| `GET /api/finance/meta` | Konton, kontonummer, kategorier, typer, år och datumspann. |
| `GET /api/finance/dashboard` | Grafer/sammanfattning. `year` utan datumfilter begränsar till året; saknat `year` betyder all historik. |
| `GET /api/finance/hero` | Tillgångar, lån/netto och senaste transaktioner. |
| `GET /api/finance/transactions` | Lista, antal och `sum_amount` med samma filter före pagination. |
| `POST /api/finance/manual` | Skapar manuell transaktion och loggar händelsen. |
| `GET /api/finance/activity-log` | Import-, manuell- och AI-händelser med `limit`, `offset`, `event_type`. |
| `GET /api/finance/compare` | Kontojämförelse med `account_a`, `account_b`, `months`/`year`/`month_from`/`month_to`. |
| `PATCH /api/finance/transactions/{id}/category` | Byter kategori och kan låsa liknande transaktioner. |
| `GET/POST/PUT/DELETE /api/finance/loans` | Lån/skulder som räknas in i netto. |

`GET /api/finance/transactions` stödjer bland annat:

- `account` eller `accounts=a,b`
- `category` eller `categories=a,b`
- `flow=expense|income`, `typ`, `year`, `date_from`, `date_to`
- `search`, `exclude_overforing=true`, `max_amount`, `chart_max_amount`
- `chart_exclusions=true` (tar bort `Bostadsköp (engång)` och beskrivningar med
  `slutlikvid`)
- sortering på `txn_date`, `amount`, `description`, `account`, `category`
- `limit` 1-500 och `offset`

## Uppgifter och kalender

Underhålls-API:t ligger under `/api/tasks`:

- `GET /api/tasks?view=next_month|next_quarter|this_year|overdue|all`
- `GET /api/tasks/stats/summary`
- `GET /api/tasks/completions?search=&limit=`
- `POST /api/tasks`, `PUT /api/tasks/{id}`, `DELETE /api/tasks/{id}`
- `POST /api/tasks/{id}/complete` med `completed_by`, `note`, `completed_at`

Kalenderexporten är `GET /api/calendar/ical`. Den skapar heldagshändelser för
alla uppgifter med `next_deadline`.

## Drift och felsökning

| Problem | Kontroll |
|---------|----------|
| 401 från API | Kontrollera `app_api_key` och skicka `X-API-Key` eller Bearer-token. |
| HA visar gammal data | Uppdatera add-on, välj **Återuppbygg**, starta om. Starten kopierar bara bundlad DB/config när hash skiljer sig. |
| Git saknar senaste lokala ändring | Stoppa uvicorn och kör WAL-checkpointen ovan innan commit. |
| CSV importeras inte | Kontrollera `data/finance/inbox/<konto>/`, `unknown_files`, kontonummer i `finance_config.json` och aktivitetsloggen. |
| Finance-AI timeout | Sänk `ai_batch_size`, höj `ai_timeout_seconds` eller testa endpointen via `/api/finance/ai/test`. |
| Massradering behövs i dev | `DELETE /api/finance/transactions` svarar bara om `ALLOW_WIPE=1`. |
| Stäng-knappen saknas | `/api/shutdown` är endast tillåten från localhost eller med `ALLOW_SHUTDOWN=1`. |

## Tester

```bash
pip install -r requirements-dev.txt
pytest tests/ -v
```

## Installation som HA add-on

1. Lägg till repot under **Add-ons → Add-on store → Repositories**
2. **Install → Start**
3. Sätt **`app_api_key`** under add-on **Configuration** (rekommenderas vid Tailscale)
4. Öppna **Öppna webbgränssnittet** eller gå till `http://<host>:8765`

Se **STRUCTURE.md** för filöversikt.

**Obs:** Tidigare versioner av repot innehöll hårdkodade kontonummer i defaults. Befintlig `finance_config.json` på din dator påverkas inte.
