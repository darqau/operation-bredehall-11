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

## Ekonomi — arbetsflöde och API

Ekonomidelen utgår från konton i **`data/finance_config.json`**. `folder_map`
styr vilka konton som får lokala inbox-mappar under
`data/finance/inbox/<konto>`, och `account_numbers` används för att visa
kontonummer samt hjälpa importen att hitta rätt konto.

### CSV-import

1. Lägg CSV-filer i rätt inbox-mapp eller ladda upp via appen.
2. Kör importen i appen eller `POST /api/finance/process`.
3. Importen läser `storage_mode`:
   - `local`: plockar `*.csv` från `data/finance/inbox/<konto>`.
   - `gdrive`: hämtar CSV via Google Drive-konfigurationen.
4. Rader skrivs till SQLite först. Lokala filer flyttas sedan till
   `data/finance/archive/<konto>`; om filnamnet redan finns får kopian suffix.

Viktiga begränsningar:

- Uppladdning via `POST /api/finance/upload` accepterar max 10 MB per fil.
- Kontot kan anges explicit (`account`) eller auto-detekteras från filnamn,
  kontonummer, avsändare/mottagare och befintliga konton.
- Okända filer lämnas kvar i inbox och returneras i `unknown_files`.
- Filer som hör till ett annat konto kan flyttas logiskt till rätt konto och
  syns i `rerouted`.
- Dubbletter för importerade bankrader identifieras med konto + datum + belopp
  i ören + normaliserad beskrivning. Manuella rader dedupliceras inte på detta
  sätt.
- Interna överföringar märks med `typ = "Överföring"` utifrån
  `own_accounts_regex` och debit/kredit-par.

Exempel med API-nyckel:

```bash
curl -H "X-API-Key: $APP_API_KEY" \
  "http://127.0.0.1:8890/api/finance/transactions?accounts=Gemensamt%20konto,Sparkonto&flow=expense&year=2026&limit=50"
```

### Viktiga finance-endpoints

| Endpoint | Syfte | Viktiga parametrar/svar |
|----------|-------|-------------------------|
| `GET /api/finance/config` | Läs ekonomiinställningar | Hemliga fält maskas; svaret visar t.ex. `has_ai_api_key`. |
| `PUT /api/finance/config` | Uppdatera konton, lagring, AI m.m. | `ai_api_key="__UNCHANGED__"` behåller befintlig nyckel. |
| `GET /api/finance/folders` | Lista konton/inboxar | Visar `pending_files` per konto. |
| `POST /api/finance/folders` | Skapa konto/inbox | Loggar `account_created`. |
| `POST /api/finance/detect` | Förhandsgranska konto-detektering för en CSV | Returnerar kandidater och eventuell `detected_account`. |
| `POST /api/finance/upload` | Ladda upp CSV | `account` valfritt, `auto_process=true` importerar direkt. |
| `POST /api/finance/process` | Bearbeta inbox/Drive | Returnerar antal tillagda/hoppade rader, `by_account`, `unknown_files`, `rerouted`, `internal_transfers`. |
| `GET /api/finance/activity-log` | Import-/AI-/manuell historik | `limit`, `offset`, `event_type`; detaljer är JSON när de finns. |
| `GET /api/finance/transactions` | Lista transaktioner | Filter: `account`/`accounts`, `category`/`categories`, `flow`, `typ`, `year`, `date_from`, `date_to`, `search`, `exclude_overforing`, `max_amount`, `chart_max_amount`, `chart_exclusions`. Svaret innehåller `total` och `sum_amount` före paginering. |
| `GET /api/finance/dashboard` | Aggregat för ekonomi-dashboard | Om `year` saknas används hela historiken; grafer kan kapa engångsposter med `chart_max_amount`. |
| `GET /api/finance/hero` | Snabböversikt | Summerar senaste saldon, lån/skulder, nettoförmögenhet och rullande snitt. |
| `GET /api/finance/compare` | Jämför två konton per månad | Kräver `account_a` och `account_b`; `categories`, `year`, `month_from`, `month_to`, `months`; överföringar exkluderas som standard och inkomstkategorier kapas inte av `chart_max_amount`. |
| `PATCH /api/finance/transactions/{id}/category` | Lås kategori | `apply_to_similar=true` applicerar på rader med exakt samma beskrivning. |
| `GET /api/finance/ai/queue` och `POST /api/finance/ai/batch` | AI-kategorisering | Kräver `ai_enabled`; batchstorlek begränsas av query eller config. |
| `GET/POST /api/finance/loans`, `PUT/DELETE /api/finance/loans/{id}` | Lån/skulder | Lån används i `hero.net_worth`. |

### Felsökning ekonomi

- **Import hittar inte konto:** kör `POST /api/finance/detect` på filen och
  uppdatera `account_numbers` eller filnamn/inbox. Okända filer ligger kvar i
  inbox tills det går att avgöra konto.
- **Summeringar ser för höga ut:** använd `exclude_overforing=true` och kontrollera
  `own_accounts_regex`; kör `POST /api/finance/detect-transfers` efter regex-ändring.
- **Graf saknar stora köp:** dashboard och jämförelse kapar stora
  engångsposter med `chart_max_amount` och exkluderar kategorin
  `Bostadsköp (engång)` samt beskrivningar som innehåller `slutlikvid`.
- **AI gör inget:** kontrollera `GET /api/finance/config` (`ai_enabled`,
  `has_ai_api_key`) och testa `GET /api/finance/ai/test`.

## Data — en databas, samma överallt

All data (uppgifter, transaktioner, lån) ligger i **`data/bredehall.db`**. Filen ligger i git tillsammans med **`data/finance_config.json`**. Det är den enda källan — du behöver inte importera CSV igen när Home Assistant uppdateras.

| Var du öppnar appen | Vad som händer |
|---------------------|----------------|
| **Datorn** (`127.0.0.1:8890`) | Läser `data/bredehall.db` direkt |
| **Home Assistant / Tailscale** (`:8765`) | Får samma fil från git vid omstart (automatisk kopiering om innehållet skiljer sig) |

### Rutin efter ändringar

1. Gör ändringar lokalt på datorn.
2. **Stoppa** den lokala servern (Ctrl+C) innan du sparar till git. Medan appen kör håller den databasen öppen — då riskerar git att missa det senaste. Tillfälliga sidofiler (`.db-wal`, `.db-shm`) försvinner när servern stoppats och allt skrivits in i huvudfilen.
3. Skriv ihop WAL till huvudfilen om SQLite har använt sidofiler:
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
