# Operation Bredehall 11

Smart underhållsplanerare och privatekonomi för villan — Custom Add-on för Home Assistant.

## Öppna appen

| Väg | URL | Auth |
|-----|-----|------|
| **Direkt port (LAN/Tailscale)** | `http://<host>:8765` | API-nyckel (`app_api_key` i add-on-konfig) |
| **Från Home Assistant** | Add-on → **Öppna webbgränssnittet** | Samma som ovan |

**Tailscale (mobil):** `http://<HA Tailscale-IP>:8765` — t.ex. `http://100.x.x.x:8765`. Ange API-nyckeln under **Inställningar** i appen första gången.

Add-on använder **egen port** (som Trafik-Dashboard), inte HA Ingress.

Lokal utveckling utan API-nyckel:

```bash
cd operation_bredehall_11
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8890
```

Öppna http://127.0.0.1:8890 — ingen nyckel krävs om `APP_API_KEY` inte är satt.

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

Add-onen är en FastAPI-app med statiskt frontend under `app/static/`.

1. `run.sh` läser `port` och `app_api_key` från Home Assistant options och startar uvicorn.
2. `app.main.lifespan()` synkar git-bundlad data till `/data`, skapar tabeller, kör migrationer och gör idempotenta finance-backfills.
3. `app/database.py` väljer datakatalog: `DATA_DIR` om satt, annars `/data` i HA, annars lokal `operation_bredehall_11/data/`.
4. Frontend anropar API:erna under `/api/*`; statiska filer och `/health` är publika.

## Data — en databas, samma överallt

All data (uppgifter, transaktioner, lån) ligger i **`data/bredehall.db`**. Filen ligger i git tillsammans med **`data/finance_config.json`**. Det är den enda källan — du behöver inte importera CSV igen när Home Assistant uppdateras.

| Var du öppnar appen | Vad som händer |
|---------------------|----------------|
| **Datorn** (`127.0.0.1:8890`) | Läser `data/bredehall.db` direkt |
| **Home Assistant / Tailscale** (`:8765`) | Får samma fil från git vid omstart (automatisk kopiering om innehållet skiljer sig) |

Vid add-on-start jämför `app/data_sync.py` SHA-256 för `bredehall.db` och `finance_config.json` mellan image-bundlen (`/app/data`) och runtime-volymen (`/data`). Om filerna skiljer sig vinner git-versionen och kopieras till `/data`. Det gör git till canonical source och betyder att ändringar gjorda direkt i HA kan skrivas över vid nästa uppdatering/omstart om de inte först förs tillbaka till repot.

### Rutin efter ändringar

1. Gör ändringar lokalt på datorn.
2. **Stoppa** den lokala servern (Ctrl+C) innan du sparar till git. Medan appen kör håller den databasen öppen — då riskerar git att missa det senaste. Tillfälliga sidofiler (`.db-wal`, `.db-shm`) försvinner när servern stoppats och allt skrivits in i huvudfilen.
3. Commit och push (`data/bredehall.db` + `data/finance_config.json`).
4. Home Assistant: uppdatera add-on → **Återuppbygg** → **Starta om**.

**OBS:** Ändringar du bara gör via mobil/Tailscale följer inte med till git automatiskt. Gör ekonomiändringar på datorn om de ska sparas i repot.

CSV-arkivet (`data/finance/`) stannar på datorn (gitignored) — transaktionerna finns redan i databasen.

Repot innehåller riktig ekonomidata — håll det **privat** på GitHub.

## Konfiguration

| Plats | Nyckel | Effekt |
|-------|-------|--------|
| Add-on options / env | `app_api_key` / `APP_API_KEY` | Kräver API-nyckel för alla privata API:er på direktporten. |
| Add-on options | `port` | Port som uvicorn lyssnar på i containern, standard `8765`. |
| Add-on options | `openai_api_key` | Används av underhålls-AI under `/api/ai/*`. |
| Add-on options | `finance_storage_mode` | Initierar finance-lagring (`local`/`gdrive`) bara när `finance_config.json` saknas. |
| `data/finance_config.json` | `folder_map`, `account_numbers` | Konton, lokala inbox-mappar och kontonummer som visas i UI/API. |
| `data/finance_config.json` | `own_accounts_regex` | Matchar egna konton vid intern överföringsdetektion. |
| `data/finance_config.json` | `ai_*` | Finance-AI för kategorisering och lånetolkning. |

`google_calendar_credentials` finns kvar i add-on-konfigurationen, men aktuell kalenderintegration är `.ics`-export via `/api/calendar/ical`; det finns ingen Google Calendar API-synk i koden.

## API och arbetsflöden

### Auth

Om `app_api_key` är tom släpps alla requests igenom, vilket förenklar lokal utveckling. När nyckeln är satt kräver privata endpoints antingen `X-API-Key: <nyckel>` eller `Authorization: Bearer <nyckel>`.

Publika paths är:

- `/`
- `/health`
- `/static/*`
- `/api/auth/status`

Requests med `X-Ingress-Path` släpps också igenom eftersom Home Assistant redan har autentiserat dem, men add-onen kör normalt med `ingress: false` och direktport.

### Uppgifter och kalender

- `GET /api/tasks?view=next_month|next_quarter|this_year|overdue|all&year=2026&category=...&search=...`
- `POST /api/tasks`, `PUT /api/tasks/{id}`, `DELETE /api/tasks/{id}`
- `POST /api/tasks/{id}/complete` loggar slutförande med valfri utförare, anteckning och datum.
- `GET /api/tasks/stats/summary` och `GET /api/tasks/completions` driver översikter och historik.
- `GET /api/calendar/ical` exporterar alla uppgifter med deadline som heldagshändelser i `.ics`.

### Ekonomi: import

Finance-importen använder `data/finance_config.json` och lokala mappar under `data/finance/`:

```text
data/finance/inbox/<konto>/*.csv   # lägg nya bankfiler här
data/finance/archive/<konto>/      # filer flyttas hit efter lyckad DB-import
```

Vanligt flöde:

1. Lägg CSV i rätt inbox, eller använd `POST /api/finance/upload` med `account` eller autodetektering.
2. Kör `POST /api/finance/process` om upload inte auto-processar.
3. Importen parsar svenska bankformat med `;` eller `,`, kodningar `utf-8-sig`, `utf-8`, `cp1252`, `latin-1`.
4. Rader klassas med regler och learned categories.
5. I local mode flyttas CSV-filen till archive först efter lyckad DB-insert. Vid DB-fel lämnas filen i inbox.

Dubbletter hoppas över för icke-manuella transaktioner med fingerprint:

```text
account + txn_date + amount_ore + normaliserad description
```

Manuella rader (`POST /api/finance/manual`) ingår inte i CSV-dedupen.

### Ekonomi: analys och filtrering

`GET /api/finance/transactions` stödjer:

- `account`, `category`, `typ`
- `year` eller `date_from`/`date_to` (`date_from`/`date_to` tar över årsfiltret)
- `search` på description, med escapade SQL LIKE-wildcards
- `exclude_overforing=true`
- `max_amount`
- `sort_by=txn_date|amount|description|account|category`, `sort_dir=asc|desc`
- `limit` 1-500 och `offset`

Svaret innehåller `total`, `items` och `sum_amount`; summan använder samma filter som listan men före paginering.

`GET /api/finance/dashboard` använder samma filter och lägger till `chart_max_amount` (standard `100000`) för grafer. Dashboarden visar alltid senaste saldo per konto och låneskuld som översikt, medan diagrammen filtrerar bort interna överföringar vid flagga, kategorierna `Överföring` och `Bostadsköp (engång)`, descriptions med `slutlikvid` samt belopp över `chart_max_amount`.

### Ekonomi: kategorier, AI och lån

- Regelmotorn finns i `app/services/finance/categorizer.py` och sätter både `typ` (`Inkomst`, `Utgift`, `Överföring`) och `category`.
- Manuell kategoriändring via `PATCH /api/finance/transactions/{id}/category` låser raden (`category_locked`) och kan appliceras på liknande transaktioner med exakt samma description.
- `POST /api/finance/detect-transfers` skannar om egna kontoöverföringar med `own_accounts_regex`.
- Finance-AI kräver `ai_enabled=true` och `ai_*` i `finance_config.json`; kö/endpoints finns under `/api/finance/ai/*`.
- Lån/skulder hanteras via `/api/finance/loans*`; `parse-text` och `parse-image` använder finance-AI-konfigurationen.

### Drift och felsökning

| Symptom | Kontroll |
|---------|----------|
| `401 Ogiltig eller saknad API-nyckel` | Kontrollera `app_api_key`, webbläsarens sparade nyckel och att klienten skickar `X-API-Key` eller Bearer-token. |
| Appen saknar senaste lokala ändring i HA | Säkerställ att `data/bredehall.db` och `data/finance_config.json` är commit/pushade, uppdatera add-onen, välj **Återuppbygg** och starta om. |
| Git visar inte DB-ändringen | Stoppa lokal uvicorn och kör en SQLite WAL checkpoint innan commit. |
| CSV ligger kvar i inbox | Importen fick parser- eller DB-fel; åtgärda felet och kör `/api/finance/process` igen. |
| Transaktioner räknas dubbelt i grafer | Kontrollera om det är olika konton eller manuella rader; CSV-dedup gäller per konto och ignorerar manuella rader. |
| Mass-radering behövs i dev | Starta med `ALLOW_WIPE=1`; annars returnerar `DELETE /api/finance/transactions` 404. |

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
