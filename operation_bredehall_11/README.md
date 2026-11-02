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

- **Backend:** FastAPI i `app/main.py`, med routrar för `tasks`, `calendar`, `ai` och `finance`.
- **Frontend:** statisk SPA i `app/static/` som anropar samma API som externa klienter kan använda.
- **Databas:** SQLite via SQLAlchemy. `DATA_DIR` styr var `bredehall.db` och `finance_config.json` ligger.
- **HA-start:** `run.sh` läser `port` och `app_api_key` från add-on options och startar uvicorn.
- **Auth:** `app_api_key` krävs för API:et när nyckel är satt. Skicka `X-API-Key: <nyckel>` eller `Authorization: Bearer <nyckel>`.

Publika vägar utan API-nyckel när auth är på: `/`, `/health`, `/static/*`, `/api/auth/status` och `/api/shutdown/status`.

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
- **`finance_config.json` är källan för finance storage.** Add-on option `finance_storage_mode` finns i manifestet men skriver inte över den persistenta filen; ändra storage via appens inställningar eller filen.
- Google Drive-import kräver service account JSON via `gdrive_credentials_path`, `GDRIVE_CREDENTIALS_PATH`, `data/gdrive_credentials.json`, `/config/gdrive_credentials.json` eller `/data/gdrive_credentials.json`.

## Ekonomi: import och kategorisering

Ekonomiflödet är byggt för att databasen är sanningen, inte CSV-filerna.

1. Konton finns i `finance_config.json` (`folder_map` + `account_numbers`).
2. Lokalt läggs CSV-filer i `data/finance/inbox/<konto>/` eller laddas upp via API/UI.
3. `POST /api/finance/detect` gissar konto med kontonummer i filnamn/CSV-fält och namn-/bankledtrådar.
4. `POST /api/finance/upload` sparar filen i inbox. Med `auto_process=true` bearbetas den direkt; utan säkert kontoval krävs `account`.
5. `POST /api/finance/process` läser inbox eller Google Drive beroende på `storage_mode`.
6. Efter lyckad DB-insert flyttas lokala CSV-filer till `data/finance/archive/<konto>/`. Arkivet är gitignored.

Importregler och begränsningar:

- Max uppladdningsstorlek är 10 MB per fil.
- CSV avkodas som `utf-8-sig`, därefter `utf-8`, `cp1252` eller `latin-1`.
- Dubbletter hoppas över per konto med fingeravtryck: datum + belopp i öre + normaliserad beskrivning. Manuella transaktioner ingår inte i denna dedup.
- Okända filer lämnas kvar i inbox och rapporteras som `unknown_files`; säkert detekterade filer kan routas till rätt konto och visas i `rerouted`.
- Import, batchkörning, manuella transaktioner, kontoändringar och AI-kategorisering loggas i `/api/finance/activity-log`.
- Interna överföringar märks med `typ = "Överföring"` via `own_accounts_regex` och kan exkluderas i vyer och API-frågor.

### Vanliga finance-API:er

Alla exempel nedan kräver API-nyckel när `app_api_key` är satt:

```bash
curl -H "X-API-Key: $BREDEHALL_KEY" \
  "http://<host>:8765/api/finance/transactions?accounts=Konto%20A,Konto%20B&category=Livsmedel&flow=expense&date_from=2026-01-01&date_to=2026-01-31"
```

| Endpoint | Syfte |
|----------|-------|
| `GET /api/finance/meta` | Konton, kategorier, typer, år och datumspann |
| `GET /api/finance/hero` | Översikt: tillgångar, skulder, nettoförmögenhet, rullande snitt och topputgifter |
| `GET /api/finance/dashboard` | Aggregerade grafer och senaste transaktioner |
| `GET /api/finance/transactions` | Transaktionslista med `total`, `sum_amount`, sortering och paginering |
| `GET /api/finance/compare` | Månadssummering för två konton |
| `GET /api/finance/activity-log` | Import-/AI-/kontoaktivitet, filtrerbar med `event_type` |
| `POST /api/finance/manual` | Skapa manuell transaktion |
| `PATCH /api/finance/transactions/{id}/category` | Byt kategori och lås raden; `apply_to_similar` använder exakt beskrivningsmatch |
| `GET /api/finance/transactions/{id}/similar` | Räkna liknande transaktioner inför massändring |
| `GET/POST/PUT/DELETE /api/finance/loans` | Hantera lån/skulder som ingår i hero/nettoförmögenhet |

Filter för `transactions`:

- Konto: `account=<namn>` eller `accounts=Konto A,Konto B`
- Kategori: `category=<namn>` eller `categories=A,B`
- Flöde/typ: `flow=expense|income`, `typ=<typ>`
- Tid: `year=2026` eller `date_from=YYYY-MM-DD&date_to=YYYY-MM-DD` (datumintervall vinner över år)
- Text/belopp: `search=<text>`, `max_amount=<kr>`, `chart_max_amount=<kr>`
- Diagramlogik: `exclude_overforing=true`, `chart_exclusions=true`
- Sortering/paginering: `sort_by=txn_date|amount|description|account|category`, `sort_dir=asc|desc`, `limit`, `offset`

`sum_amount` använder samma filter som listan innan `limit`/`offset` appliceras.

### Dashboard- och jämförelsebeteende

- Saknas `year` i `/api/finance/dashboard` visas hela historiken; egen datumperiod filtrerar hårdare än år.
- Diagram hoppar alltid över kategorin `Bostadsköp (engång)`, beskrivningar som innehåller `slutlikvid` och belopp över `chart_max_amount` (standard 100 000 kr). `exclude_overforing=true` tar även bort interna överföringar.
- Dashboardens kontobalanser använder senaste bankrapporterade saldo per konto och är inte begränsade av sidans filter.
- `GET /api/finance/compare` jämför två konton per månad. Utgiftskategorier summeras som positiva utgifter; inkomstkategorier, till exempel `Lön`, behandlas som inkomster och kapas inte av standardtaket 100 000 kr.
- Frontendens transaktionstabell styrs av senast aktiva källa: globalfilter eller kontojämförelse. Kontexttexten ovanför tabellen visar vilken källa som gäller.

### AI för ekonomi

Det finns två separata AI-ytor:

- `/api/ai/*` använder add-on option `openai_api_key` för underhållsanalys och bidragssökning.
- `/api/finance/ai/*` och lånetolkning använder `finance_config.json`: `ai_enabled`, `ai_base_url`, `ai_api_key`, `ai_model`, `ai_timeout_seconds`, `ai_batch_size`.

Finance-AI är avstängd tills `ai_enabled=true`. Batchkategorisering tar högst 30 rader per anrop och låser granskade rader (`category_locked`) så att användarvalda kategorier kan läras in för framtida importer.

## Uppgifter och kalender

Viktiga endpoints:

- `GET /api/tasks?view=next_month|next_quarter|this_year|overdue|all&year=2026&category=...&search=...`
- `GET /api/tasks/stats/summary`
- `GET /api/tasks/completions?search=...&limit=200`
- `POST /api/tasks`, `PUT /api/tasks/{id}`, `DELETE /api/tasks/{id}`
- `POST /api/tasks/{id}/complete` med `completed_by`, `note`, `completed_at`
- `GET /api/calendar/ical` exporterar deadlines som en `.ics`-fil för import i kalender.

`google_calendar_credentials` finns kvar som add-on option, men nuvarande verifierade kalenderintegration är endast `.ics`-exporten.

## Felsökning och drift

- **401 på API:** kontrollera att `app_api_key` i HA matchar nyckeln i appens Inställningar/localStorage.
- **HA visar gammal data:** commit/pusha `data/bredehall.db` och `data/finance_config.json`, uppdatera add-on, välj **Återuppbygg** och starta om.
- **CSV importeras inte:** kör `/api/finance/detect`, kontrollera `account_numbers`, filens avgränsare (`csv_delimiter`) och `unknown_files` i `/api/finance/process`.
- **Dubbletter eller saknade skrivningar lokalt:** stoppa uvicorn innan commit och checkpointa WAL till huvudfilen om databasen ändrats under körning.
- **Google Drive-fel:** kontrollera credentials-sökväg, folder-id per konto och `archive_folder_id` om filer ska flyttas efter läsning.
- **Utvecklingswipe:** `DELETE /api/finance/transactions` är dolt och svarar bara när `ALLOW_WIPE=1`.

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
