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
- API-klienter skickar nyckeln som `X-API-Key: ...` eller `Authorization: Bearer ...`.
- Publika vägar när nyckel är satt: `/`, `/health`, `/static/*`, `/api/auth/status` och `/api/shutdown/status`.
- Mass-radering av transaktioner (`DELETE /api/finance/transactions`) är borttagen; dev-wipe kräver `ALLOW_WIPE=1`.

## Funktioner

- Underhållsuppgifter med vyer, deadline och `.ics`-export
- Ekonomi: CSV-import, kategorisering (regler + valfri lokal AI), grafer, bolån/skulder
- Kategorisida med inline-redigering

## Ekonomi — arbetsflöde och API

Ekonomidelen lagrar importerade bankrader som transaktioner i SQLite. CSV-filer är bara indata och arkiv.

### Konfiguration och mappar

- **`data/finance_config.json`** styr konton (`folder_map`), kontonummer (`account_numbers`), `storage_mode`, AI-inställningar och `own_accounts_regex`.
- Vid lokal import används `data/finance/inbox/<konto>/` och `data/finance/archive/<konto>/`.
- `storage_mode=local` läser lokala inbox-mappar. `storage_mode=gdrive` hämtar CSV från Drive-mappar och kräver credentials via `gdrive_credentials_path`, `GDRIVE_CREDENTIALS_PATH`, `data/gdrive_credentials.json`, `/config/gdrive_credentials.json` eller `/data/gdrive_credentials.json`.
- HA-optionen `finance_storage_mode` används bara när `finance_config.json` saknas. Ändra därför läge i appens inställningar eller direkt i filen när konfigen redan finns.

### Importflöde

1. Ladda upp CSV i UI eller lägg filer i `data/finance/inbox/<konto>/`.
2. `POST /api/finance/detect` kan förhandsvisa kontodetektering. Detektion använder filnamn, kontonummer i filnamn/avsändare/mottagare och kontonamn/hints.
3. `POST /api/finance/upload` sparar filen i vald eller auto-detekterad inbox. Okänt konto ger 422 så användaren kan välja konto.
4. `POST /api/finance/process` importerar alla väntande CSV-filer.
5. Lokala filer flyttas till archive först efter lyckad DB-insert. Vid DB-fel ligger filen kvar i inbox.

Begränsningar: uppladdning är max 10 MB per fil och endast `.csv` hanteras. Filer med låg detektionspoäng listas som `unknown_files` och lämnas kvar. Filer som säkert hör till annat konto kan omdirigeras; svaret innehåller `rerouted`.

### Dubbletter, kategorier och överföringar

- Dubblettnyckel för bankrader är **konto + datum + belopp i ören + normaliserad beskrivning**. Manuella rader dedupliceras inte mot CSV-import.
- Kategorier sätts först av inlärda manuella val (`category_locked`), sedan regelbaserad kategorisering.
- När en kategori ändras via `PATCH /api/finance/transactions/{id}/category` kan samma exakta beskrivning uppdateras samtidigt (`apply_to_similar=true`).
- Interna överföringar hittas genom matchande negativ/positiv transaktion på olika egna konton inom tre dagar, plus textsignal från `own_accounts_regex` eller överföringsord. De markeras som typ/kategori `Överföring` och exkluderas från flera summeringar när `exclude_overforing=true`.

### Analysvyer och filter

| Endpoint | Användning |
|----------|------------|
| `GET /api/finance/meta` | Konton, kategorier, typer, år, datumintervall och antal transaktioner |
| `GET /api/finance/hero` | Totala tillgångar, lån/skulder, nettovärde, rullande netto och topputgifter |
| `GET /api/finance/dashboard` | Diagramdata, senaste transaktioner och balansserier |
| `GET /api/finance/transactions` | Paginering, sortering, filtrering och `sum_amount` för matchande rader |
| `GET /api/finance/compare` | Månadsjämförelse mellan två konton |
| `GET /api/finance/activity-log` | Import-, konto-, manuell transaktions- och AI-historik |
| `GET /api/finance/categories/stats` | Kategorisummering per år/månad/konto |

Viktiga filter för `transactions` och dashboard: `account` eller `accounts`, `category` eller `categories`, `flow=expense|income`, `typ`, `year`, `date_from`, `date_to`, `search`, `exclude_overforing`, `max_amount`, `chart_max_amount` och `chart_exclusions`. Om datumintervall anges används det före `year`.

Dashboard-diagram döljer stora engångsposter som standard (`chart_max_amount=100000`) och exkluderar kategorin `Bostadsköp (engång)` samt beskrivningar med `slutlikvid`. Account-compare väljer utgiftsflöde om kategorierna är utgifter, inkomstflöde om alla valda kategorier är inkomstkategorier, annars blandat flöde.

### AI och lån

- Underhålls-AI ligger under `/api/ai/*` och använder HA-optionen `openai_api_key`.
- Ekonomi-AI ligger under `/api/finance/ai/*` och använder `finance_config.json` eller `FINANCE_AI_*` env. Den är avstängd tills `ai_enabled=true`.
- Batchstorlek och timeout begränsas till 1-30 transaktioner och 60-1800 sekunder (`ai_batch_size`, `ai_timeout_seconds`). Osäkra AI-svar lämnas som `Övrigt`, men raderna låses som granskade så kön går framåt.
- `/api/finance/ai/reviewed` visar låsta granskade rader. `/api/finance/activity-log?event_type=ai_categorize` visar per-körningens detaljer.
- Lån hanteras via `/api/finance/loans*`. Text- och bildtolkning kräver ekonomi-AI-konfiguration; bildtolkning skickar uppladdad fil till den OpenAI-kompatibla klienten.

## Data — en databas, samma överallt

All data (uppgifter, transaktioner, lån) ligger i **`data/bredehall.db`**. Filen ligger i git tillsammans med **`data/finance_config.json`**. Det är den enda källan — du behöver inte importera CSV igen när Home Assistant uppdateras.

| Var du öppnar appen | Vad som händer |
|---------------------|----------------|
| **Datorn** (`127.0.0.1:8890`) | Läser `data/bredehall.db` direkt |
| **Home Assistant / Tailscale** (`:8765`) | Får samma fil från git vid omstart (automatisk kopiering om innehållet skiljer sig) |

### Rutin efter ändringar

1. Gör ändringar lokalt på datorn.
2. **Stoppa** den lokala servern (Ctrl+C) innan du sparar till git. Medan appen kör håller den databasen öppen — då riskerar git att missa det senaste. Tillfälliga sidofiler (`.db-wal`, `.db-shm`) försvinner när servern stoppats och allt skrivits in i huvudfilen.
3. Kontrollera att WAL är ihopskriven om du är osäker:
   ```bash
   python -c "import sqlite3; c=sqlite3.connect('data/bredehall.db'); c.execute('PRAGMA wal_checkpoint(TRUNCATE)'); c.close()"
   ```
4. Commit och push (`data/bredehall.db` + `data/finance_config.json`).
5. Home Assistant: uppdatera add-on → **Återuppbygg** → **Starta om**.

**OBS:** Ändringar du bara gör via mobil/Tailscale följer inte med till git automatiskt. Gör ekonomiändringar på datorn om de ska sparas i repot.

CSV-arkivet (`data/finance/`) stannar på datorn (gitignored) — transaktionerna finns redan i databasen.

Repot innehåller riktig ekonomidata — håll det **privat** på GitHub.

## Konfiguration

- **`data/finance_config.json`** — konton, mappar, AI (följer med i git)
- **Add-on options** — `port`, `app_api_key`, `openai_api_key`, `google_calendar_credentials`, `finance_storage_mode`
- `google_calendar_credentials` finns i manifestet, men nuvarande kalenderintegration är `.ics`-export via `/api/calendar/ical`; ingen Google Calendar API-synk körs.

## Drift och felsökning

- `GET /health` ska svara `ok` och används av HA watchdog.
- `GET /api/auth/status` visar om API-nyckel krävs.
- Om dashboarden saknar nya bankrader: kontrollera `data/finance/inbox/<konto>/`, `GET /api/finance/activity-log`, `unknown_files` i importsvar och att kontonummer finns i `finance_config.json`.
- Om summeringar verkar för höga: slå på `exclude_overforing=true` och kontrollera `own_accounts_regex`; kör `POST /api/finance/detect-transfers` efter större kontoändringar.
- Om AI-kategorisering hänger: minska `ai_batch_size`, höj `ai_timeout_seconds` eller testa anslutningen via `GET /api/finance/ai/test`.
- Vid lokal utveckling är `POST /api/shutdown` bara tillåten från localhost eller med `ALLOW_SHUTDOWN=1`.

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
