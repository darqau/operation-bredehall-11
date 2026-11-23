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

## Data — en databas, samma överallt

All data (uppgifter, transaktioner, lån) ligger i **`data/bredehall.db`**. Filen ligger i git tillsammans med **`data/finance_config.json`**. Det är den enda källan — du behöver inte importera CSV igen när Home Assistant uppdateras.

| Var du öppnar appen | Vad som händer |
|---------------------|----------------|
| **Datorn** (`127.0.0.1:8890`) | Läser `data/bredehall.db` direkt |
| **Home Assistant / Tailscale** (`:8765`) | Får samma fil från git vid omstart (automatisk kopiering om innehållet skiljer sig) |

### Rutin efter ändringar

1. Gör ändringar lokalt på datorn.
2. **Stoppa** den lokala servern (Ctrl+C) innan du sparar till git. Medan appen kör håller den databasen öppen — då riskerar git att missa det senaste. Tillfälliga sidofiler (`.db-wal`, `.db-shm`) försvinner när servern stoppats och allt skrivits in i huvudfilen.
3. Commit och push (`data/bredehall.db` + `data/finance_config.json`).
4. Home Assistant: uppdatera add-on → **Återuppbygg** → **Starta om**.

**OBS:** Ändringar du bara gör via mobil/Tailscale följer inte med till git automatiskt. Gör ekonomiändringar på datorn om de ska sparas i repot.

CSV-arkivet (`data/finance/`) stannar på datorn (gitignored) — transaktionerna finns redan i databasen.

Repot innehåller riktig ekonomidata — håll det **privat** på GitHub.

## Konfiguration

- **`data/finance_config.json`** — konton, mappar, AI (följer med i git)

### Runtime och auth

Add-on startar via `run.sh`, som läser `port` och `app_api_key` från
`/data/options.json` eller `/config/options.json`. API-nyckeln exponeras till
FastAPI som `APP_API_KEY`.

- Tom `app_api_key` betyder öppen lokal utveckling.
- När nyckel finns kräver alla API:er `X-API-Key: <nyckel>` eller
  `Authorization: Bearer <nyckel>`.
- Publika vägar är `/`, `/health`, `/static/*`, `/api/auth/status` och
  `/api/shutdown/status`.
- `POST /api/shutdown` fungerar bara från localhost eller med
  `ALLOW_SHUTDOWN=1`; den är till för Windows-startaren.

### Startup-sekvens

Vid appstart kör `app.main.lifespan()` följande i ordning:

1. `data_sync.sync_bundled_data()` kopierar git-bundlad
   `bredehall.db` och `finance_config.json` till `/data` i HA om hasharna
   skiljer sig.
2. SQLite-tabeller och idempotenta migrationer skapas.
3. Standarduppgifter/lån seedas om databasen är tom.
4. Ekonomikonfig migreras. HA-optionen `finance_storage_mode` ersätter inte
   befintlig `finance_config.json`; byt läge i filen eller via UI om den redan
   finns. Historiska ekonomi-korrigeringar körs därefter.
5. Interna överföringar detekteras och statisk kategorilista skrivs till
   `static/data/finance-categories.json`.

## Ekonomi: import och analys

Ekonomimodulen använder `data/finance_config.json` för konton,
kontonummer, lagringsläge och AI-inställningar. Lokalt läge använder
`data/finance/inbox/<konto>/` och `data/finance/archive/<konto>/`;
Google Drive-läge läser CSV-filer från konfigurerade Drive-mappar och kan
flytta dem till `archive_folder_id` efter hämtning.

`finance_config.json` är runtime-källan för `storage_mode`. Ändra inte bara
HA-optionen `finance_storage_mode` om filen redan finns; uppdatera konfigen
via appens inställningar eller genom att committa filändringen.

### CSV-flöde

| Steg | API | Beteende |
|------|-----|----------|
| Identifiera konto | `POST /api/finance/detect` | Läser max 10 MB, provar UTF-8/Latin-1 och rankar konto via kontonummer i filnamn/fält, kontonamn och bank-hints. |
| Ladda upp | `POST /api/finance/upload` | `account` kan utelämnas om detektion är säker; annars returneras 422 med kandidater. Filnamn saneras, dubblettnamn får suffix. |
| Importera | `POST /api/finance/process` | Läser inbox/Drive, parser CSV, kategoriserar, deduplicerar och arkiverar bara efter lyckad DB-insert. |

`auto_process=true` på upload importerar bara den uppladdade filen som
"trusted", så valt konto respekteras även om den vanliga detektionen hade
klassat den som okänd. En obetrodd fil i inbox lämnas kvar som
`unknown_files` om bästa score är låg, eller `rerouted` om innehållet tydligt
hör till ett annat konto.

Deduplicering gäller importerade bankrader och använder:

```text
konto + datum + belopp_i_ore + normaliserad_beskrivning
```

Manuella transaktioner (`POST /api/finance/manual`) är avsiktligt undantagna
från den dedupen.

### Transaktioner och filter

`GET /api/finance/transactions` returnerar `items`, `total`, `offset`,
`limit` och `sum_amount`. Samma filter används för listan, totalen och
summan före paginering.

Vanliga query-parametrar:

```text
account=Gemensamt konto
accounts=Konto A,Konto B
category=Mat
categories=Mat,Transport
flow=expense|income
typ=Utgift|Inkomst|Överföring
year=2026
date_from=2026-01-01&date_to=2026-12-31
search=ica
exclude_overforing=true
chart_max_amount=100000
chart_exclusions=true
sort_by=txn_date|amount|description|account|category
sort_dir=asc|desc
```

`chart_exclusions=true` döljer engångsköpet `Bostadsköp (engång)` och
beskrivningar med `slutlikvid`. `chart_max_amount` och `max_amount` filtrerar
på absolutbelopp.

### Dashboard, jämförelse och logg

- `GET /api/finance/dashboard` bygger grafer och senaste transaktioner.
  Utan `year` visas hela historiken. Grafserier exkluderar alltid
  `Bostadsköp (engång)`, `slutlikvid` och belopp över `chart_max_amount`
  (standard 100 000 kr), och deduplicerar samma datum/belopp/beskrivning i
  grafen.
- `GET /api/finance/hero` visar senaste saldo per konto, skulder/lån,
  nettoförmögenhet, rullande nettosnitt och toppkategorier.
- `GET /api/finance/compare` jämför två konton per månad. Om alla valda
  kategorier är inkomstkategorier jämförs inkomster; annars utgifter eller
  blandat. `month_from`/`month_to` använder formatet `YYYY-MM`.
- `GET /api/finance/activity-log` listar importer, nya konton,
  manuella transaktioner, batchkörningar och AI-kategoriseringar. Filtrera med
  `event_type`.

### Kategorisering och AI

Reglerna finns i `services/finance/categorizer.py`. När en kategori ändras via
`PATCH /api/finance/transactions/{id}/category` sätts `category_locked=true`;
med `apply_to_similar=true` uppdateras alla rader med exakt samma
beskrivning. Låsta beskrivningar återanvänds vid nästa CSV-import.

Interna överföringar markeras av `detect_internal_transfers()` när en negativ
rad matchar en positiv rad på annat konto med samma belopp inom tre dagar och
minst en rad har överföringssignal eller träffar `own_accounts_regex`.

Finance-AI är separat från underhålls-AI:

- Underhåll: `/api/ai/*`, använder HA-option `openai_api_key`.
- Ekonomi: `/api/finance/ai/*` och låneparsing, använder
  `finance_config.json` eller `FINANCE_AI_*` miljövariabler.

AI-kön består av icke-manuella `Övrigt`-rader som inte är låsta. Batchstorlek
är 1-30, standard 5; timeout clampas till 60-1800 sekunder. Låg confidence
blir `Övrigt`, men batchen låses ändå som granskad så kön går framåt.

## API-snabbkarta

| Område | Endpoints |
|--------|-----------|
| Auth/status | `GET /health`, `GET /api/auth/status`, `GET /api/shutdown/status` |
| Uppgifter | `GET/POST /api/tasks`, `GET/PUT/DELETE /api/tasks/{id}`, `POST /api/tasks/{id}/complete`, `GET /api/tasks/stats/summary`, `GET /api/tasks/completions` |
| Kalender | `GET /api/calendar/ical` (heldags-VEVENT för uppgifter med deadline) |
| Ekonomi config/import | `GET/PUT /api/finance/config`, `GET/POST /api/finance/folders`, `POST /api/finance/detect`, `POST /api/finance/upload`, `POST /api/finance/process` |
| Ekonomi analys | `GET /api/finance/meta`, `/hero`, `/dashboard`, `/transactions`, `/categories`, `/categories/stats`, `/compare`, `/activity-log` |
| Ekonomi kategorier/AI | `GET /api/finance/transactions/{id}/similar`, `PATCH /api/finance/transactions/{id}/category`, `POST /api/finance/detect-transfers`, `GET/POST /api/finance/ai/*` |
| Lån/skulder | `GET/POST /api/finance/loans`, `PUT/DELETE /api/finance/loans/{id}`, `POST /api/finance/loans/parse-text`, `/parse-image`, `/upsert` |

## Felsökning och fallgropar

- **HA visar gammal data:** kontrollera att `data/bredehall.db` och
  `data/finance_config.json` är committade, uppdatera add-on, välj
  **Återuppbygg** och starta om. Startup-loggen ska nämna synk om filerna
  skiljer sig.
- **Git missar senaste SQLite-skrivning:** stoppa lokal uvicorn och kör en
  WAL-checkpoint innan commit om databasen ändrats.
- **CSV hamnar inte i DB:** kontrollera svaret från `/api/finance/process`.
  `unknown_files` betyder att filen ligger kvar i inbox tills konto väljs
  eller kontonummer/hints förbättras.
- **Google Drive-import saknar filer:** `storage_mode` måste vara `gdrive`,
  mapparna måste ha Drive-ID:n och credentials söks i
  `data/gdrive_credentials.json`, `/config/gdrive_credentials.json`,
  `/data/gdrive_credentials.json` eller `GDRIVE_CREDENTIALS_PATH`.
- **AI timeout:** minska `ai_batch_size`, höj `ai_timeout_seconds`, eller
  testa endpointen med `GET /api/finance/ai/test`.
- **Massradering:** `DELETE /api/finance/transactions` är dold och returnerar
  404 om inte `ALLOW_WIPE=1` är satt. Använd inte mot produktionsdatabasen.

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
