# Operation Bredehall 11

Smart underhållsplanerare och privatekonomi för villan — Custom Add-on för Home Assistant.

## Öppna appen

| Väg | URL | Auth |
|-----|-----|------|
| Direkt port (LAN/Tailscale) | `http://<host>:8765` | API-nyckel (`app_api_key`) om satt |
| Home Assistant add-on | Add-on -> **Öppna webbgränssnittet** | Samma direkta port |
| Lokal utveckling | `http://127.0.0.1:8890` | Ingen nyckel om `APP_API_KEY` saknas |

Add-on använder egen port (inte HA Ingress). För mobil via Tailscale: öppna
`http://<HA Tailscale-IP>:8765` och ange API-nyckeln i appens inställningar.

```bash
cd operation_bredehall_11
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8890
```

## Säkerhet och auth

- Sätt `app_api_key` i add-on options när porten exponeras via LAN/Tailscale.
- När nyckel är satt kräver API:et `X-API-Key: <nyckel>` eller
  `Authorization: Bearer <nyckel>`.
- Publika vägar utan nyckel: `/`, `/health`, `/static/*`, `/api/auth/status`.
- Webbläsaren sparar nyckeln i `localStorage`.
- Mass-radering av transaktioner är dold; `DELETE /api/finance/transactions`
  svarar 404 om inte `ALLOW_WIPE=1` är satt i miljön.

Exempel:

```bash
curl -H "X-API-Key: $APP_API_KEY" http://127.0.0.1:8890/api/finance/meta
```

## Funktioner

- Underhållsuppgifter med vyer, deadline, slutförandelogg och `.ics`-export.
- Ekonomi med CSV-import, kontodetektering, kategorisering, grafer och lån/skulder.
- Regelbaserad kategorisering med valfri OpenAI-kompatibel finans-AI.
- Kategorisida där manuella kategorier kan låsas och återanvändas.

## Data — en databas, samma överallt

All appdata ligger i `data/bredehall.db`; finansinställningar ligger i
`data/finance_config.json`. Båda filerna är canonical data i git.

| Miljö | Dataväg | Beteende |
|-------|---------|----------|
| Lokal dev | `operation_bredehall_11/data/` | Läser och skriver filerna direkt. |
| HA add-on | `/data/` | Vid start kopieras git-bundlade `bredehall.db` och `finance_config.json` från `/app/data` om hash skiljer. |
| Test/override | `DATA_DIR=/tmp/...` | `app.database` använder angiven mapp. |

Konsekvens: ändringar som görs via mobil/Tailscale skrivs i HA:s `/data` men
committas inte automatiskt tillbaka till git. Gör ändringar lokalt om de ska
bli nästa canonical version.

### Commit-rutin för databasändringar

1. Stoppa lokal uvicorn innan commit så SQLite hinner skriva ihop WAL.
2. Kör checkpoint om databasen varit öppen:

   ```bash
   python -c "import sqlite3; c=sqlite3.connect('data/bredehall.db'); c.execute('PRAGMA wal_checkpoint(TRUNCATE)'); c.close()"
   ```

3. Committa `data/bredehall.db` och `data/finance_config.json` om de ändrats.
4. Committa inte `data/bredehall.db-wal`, `data/bredehall.db-shm` eller
   `data/finance/`.
5. I Home Assistant: uppdatera add-on -> **Återuppbygg** -> **Starta om**.

Repot innehåller riktig ekonomidata och ska hållas privat.

## Konfiguration

| Plats | Används till |
|-------|--------------|
| `config.yaml` | HA add-on schema, port `8765`, `app_api_key`, `openai_api_key`, `finance_storage_mode`. |
| `/data/options.json` eller `/config/options.json` | Lästs av `run.sh`, auth och AI-konfiguration i add-on. |
| `data/finance_config.json` | Konton, mappar, kontonummer, CSV-delimiter, internöverföringsregex och finans-AI. |

`finance_storage_mode` från HA options används bara när `finance_config.json`
saknas. När filen finns är den källan för finansläget (`local` eller `gdrive`).

`google_calendar_credentials` finns i add-on schema, men aktuell kalenderfunktion
är `.ics`-export via `/api/calendar/ical`; det finns ingen Google Calendar
API-synk i koden.

## Underhålls-API

Basväg: `/api/tasks`

| Endpoint | Syfte |
|----------|-------|
| `GET /api/tasks?view=next_month|next_quarter|this_year|overdue|all` | Lista uppgifter. `year`, `category` och `search` kan filtrera. |
| `POST /api/tasks` | Skapa uppgift. Om deadline saknas beräknas den från frekvensen, utom för `En gång` och `Vid behov`. |
| `POST /api/tasks/{id}/complete` | Sätt `last_done`, beräkna nästa deadline och skriv slutförandelogg. |
| `GET /api/tasks/completions` | Visa senaste slutföranden, med valfri sökning. |
| `GET /api/tasks/stats/summary` | Summering för dashboard. |
| `GET /api/calendar/ical` | Ladda ned alla uppgifter med deadline som heldagsevent i `.ics`. |

## Ekonomi: import och lagring

Basväg: `/api/finance`

### Konton och mappar

- `GET/PUT /config` visar och sparar finansinställningar. Svaret maskar
  `ai_api_key` och visar `has_ai_api_key`.
- `GET/POST /folders` listar/skapar konto-mappar. Lokalt läge skapar
  `data/finance/inbox/<konto>` automatiskt.
- `folder_map` styr kontonamnen. `account_numbers` används av kontodetektering
  och visas i dashboard/meta.

### CSV-flöde

1. Lägg bankfiler i `data/finance/inbox/<konto>` eller ladda upp med
   `POST /api/finance/upload`.
2. `POST /api/finance/detect` kan föreslå konto från filnamn, kontonummer och
   CSV-innehåll. Auto-val kräver tillräcklig träffsäkerhet.
3. `POST /api/finance/process` parser CSV-filer och skriver transaktioner.
4. Lokala filer flyttas till `data/finance/archive/<konto>` först efter lyckad
   DB-insert. Vid DB-fel lämnas filerna kvar i inbox.

Begränsningar:

- Upload accepterar högst 10 MB per fil.
- Parsern hanterar svenska belopp, vanliga datumformat och Nordea/Swedbank-lika
  exporter med `;` eller `,`.
- Dedup för importerade bankrader är `(konto, datum, belopp i ören, normaliserad
  beskrivning)`. Manuella transaktioner ingår inte i dedupen.
- I `gdrive`-läge hämtas CSV från Drive-mappar med service account credentials.
  Filer flyttas till `archive_folder_id` om den är satt.

## Ekonomi: transaktioner, dashboard och kategorier

| Endpoint | Syfte |
|----------|-------|
| `GET /transactions` | Lista transaktioner med `total`, `sum_amount` och `items`. |
| `POST /manual` | Skapa manuell transaktion. |
| `DELETE /transactions/{id}` | Ta bort en transaktion. |
| `GET /dashboard` | Grafer, kontobalanser, lån/skulder och nettoförmögenhet. |
| `GET /meta` | Konton, kategorier, typer, år och datumspann. |
| `GET /hero` | Snabb summering för startsida. |
| `GET /categories` och `/categories/stats` | Kategorilista och totalsummor. |
| `GET /transactions/{id}/similar` | Antal rader med exakt samma beskrivning. |
| `PATCH /transactions/{id}/category` | Lås kategori; `apply_to_similar=true` uppdaterar rader med exakt samma beskrivning. |
| `POST /detect-transfers` | Kör om internöverföringsdetektion. |

`GET /transactions` och `/dashboard` delar filter:

- `account`, `category`, `typ`
- `year` eller `date_from`/`date_to` (datumintervall vinner över `year`)
- `search` på beskrivning
- `exclude_overforing=true`
- `max_amount=<belopp>` för att filtrera bort stora belopp

Transaktionslistan stödjer dessutom `sort_by=txn_date|amount|description|account|category`,
`sort_dir=asc|desc`, `limit=1..500` och `offset`.

Exempel:

```bash
curl -H "X-API-Key: $APP_API_KEY" \
  "http://127.0.0.1:8890/api/finance/transactions?year=2026&category=Livsmedel&limit=50"
```

Dashboard utan `year` visar hela historiken. Graferna exkluderar alltid
`Överföring`, `Bostadsköp (engång)` och beskrivningar med `slutlikvid`;
`chart_max_amount` har standardvärde `100000` och påverkar bara graferna.

Kategorisering sker i flera steg:

1. Importen kör regler i `app/services/finance/categorizer.py`.
2. `own_accounts_regex` hjälper till att märka upp egna överföringar.
3. Internöverföringar kräver en negativ och positiv rad med samma avrundade
   belopp på olika konton inom tre dagar samt textsignal från någon rad.
4. Manuell kategoriuppdatering sätter `category_locked=True`.
5. Nya importer med exakt samma beskrivning får den låsta kategorin automatiskt.

## Ekonomi: AI och lån

Det finns två separata AI-ytor:

- `/api/ai/*` analyserar underhållsplanen och använder `openai_api_key` eller
  `OPENAI_API_KEY`.
- `/api/finance/ai/*` kategoriserar transaktioner och använder
  `finance_config.json` (`ai_enabled`, `ai_base_url`, `ai_api_key`, `ai_model`)
  eller motsvarande `FINANCE_AI_*` miljövariabler.

`/api/finance/ai/*` och lån-tolkning från text kräver `ai_enabled=true`;
bildtolkning använder samma endpoint/model och returnerar fel om AI-klienten
inte kan initieras.

| Endpoint | Syfte |
|----------|-------|
| `GET /api/finance/ai/queue` | Antal och preview av okategoriserade importerade rader. |
| `POST /api/finance/ai/batch?limit=15` | Klassificera och applicera upp till 30 rader; osäkra svar lämnas som `Övrigt`. |
| `POST /api/finance/ai/apply` | Applicera en explicit `id -> category`-mappning. |
| `GET /api/finance/ai/test` | Testa OpenAI-kompatibel endpoint. |

Lån/skulder lagras i `finance_loans` och matchas vid upsert på `account_number`.
Belopp måste vara positiva.

| Endpoint | Syfte |
|----------|-------|
| `GET/POST /api/finance/loans` | Lista eller skapa lån. |
| `PUT/DELETE /api/finance/loans/{id}` | Uppdatera eller ta bort lån. |
| `POST /api/finance/loans/parse-text` | Tolka lån ur inklistrad text med finans-AI. |
| `POST /api/finance/loans/parse-image` | Tolka lån ur bild med vision-kompatibel modell. |
| `POST /api/finance/loans/upsert` | Skapa/uppdatera flera lån efter kontonummer. |

## Felsökning

- **401 på API:** kontrollera `app_api_key` och skicka `X-API-Key` eller Bearer-token.
- **Upload kan inte välja konto:** ange `account` explicit eller fyll i
  `account_numbers`/kontonamn i `finance_config.json`.
- **CSV ligger kvar i inbox:** importen misslyckades innan DB-commit; se
  `errors` från `/api/finance/process`.
- **GDrive ger inga filer:** kontrollera `gdrive_credentials_path`, service
  account-behörighet och att `folder_map` innehåller Drive-folder-id:n.
- **HA visar gammal data:** kontrollera att `data/bredehall.db` committats,
  uppdatera add-on, kör **Återuppbygg** och starta om.

## Tester

```bash
cd operation_bredehall_11
pip install -r requirements-dev.txt
pytest tests/ -v
```

Se **STRUCTURE.md** för arkitektur och filöversikt.
