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
- API-anrop kan skicka nyckeln som `X-API-Key` eller `Authorization: Bearer <nyckel>`.
- Publika vägar utan nyckel: `/`, `/health`, `/static/*` och `/api/auth/status`.
- Mass-radering av transaktioner (`DELETE /api/finance/transactions`) är borttagen; dev-wipe kräver `ALLOW_WIPE=1`.

## Funktioner

- Underhållsuppgifter med vyer, deadline och kalenderexport via `GET /api/calendar/ical`.
- Ekonomi: CSV-import, kategorisering (regler + valfri lokal AI), grafer, bolån/skulder.
- Kategorisida med inline-redigering och lärda kategorier från manuella val.
- AI för underhållsplanen (`/api/ai/*`) använder HA-option `openai_api_key`.
- AI för ekonomi (`/api/finance/ai/*` och låntolkning) använder `finance_config.json` / Inställningar och kan peka mot en OpenAI-kompatibel lokal endpoint, t.ex. LM Studio.

### Ekonomiflöde

1. Lägg bank-CSV i rätt inbox eller ladda upp via appen.
2. Kör importen (`POST /api/finance/process`, eller automatisk import efter uppladdning).
3. Importen tolkar CSV, hoppar över dubbletter per konto + datum + belopp + normaliserad beskrivning och sparar transaktioner i SQLite.
4. Lokala CSV-filer flyttas från `data/finance/inbox/<konto>/` till `data/finance/archive/<konto>/` först efter lyckad databasimport. `data/finance/` är gitignored.

Manuella kategoriändringar låser raden (`category_locked`) och används som lärd kategori för framtida importer med exakt samma bankbeskrivning. När flera transaktioner har samma beskrivning kan appen uppdatera bara aktuell rad eller alla liknande. `POST /api/finance/recategorize?method=rules` kör om regelkategorisering, el-migrering och intern överföringsdetektering; `method=ai` kräver att ekonomi-AI är aktiverad.

Interna överföringar märks som `Överföring` när en negativ och en positiv transaktion med samma belopp finns på olika konton inom tre dagar och någon sida matchar överföringstext eller `own_accounts_regex`. Dessa kan exkluderas från intäkt/kostnad i dashboards.

## Data — en databas, samma överallt

All data (uppgifter, transaktioner, lån) ligger i **`data/bredehall.db`**. Filen ligger i git tillsammans med **`data/finance_config.json`**. Det är den enda källan — du behöver inte importera CSV igen när Home Assistant uppdateras.

| Var du öppnar appen | Vad som händer |
|---------------------|----------------|
| **Datorn** (`127.0.0.1:8890`) | Läser `data/bredehall.db` direkt |
| **Home Assistant / Tailscale** (`:8765`) | Får samma fil från git vid omstart (automatisk kopiering om innehållet skiljer sig) |

### Synk vid HA-start

- Docker-bilden innehåller `data/bredehall.db` och `data/finance_config.json` under `/app/data`.
- Vid FastAPI-start körs `sync_bundled_data()` innan tabeller, migrationer och seed-data initieras.
- I HA-containern jämförs SHA-256 mellan `/app/data/<fil>` och `/data/<fil>`. Om innehållet skiljer sig kopieras git-bundeln till `/data`, så git är canonical.
- I lokal utveckling är bundle och runtime samma `data/`-mapp, så kopieringen hoppas över.
- Ändringar som bara görs i HA/Tailscale kan skrivas över vid nästa add-on-start om git-versionen skiljer sig.

### Rutin efter ändringar

1. Gör ändringar lokalt på datorn.
2. **Stoppa** den lokala servern (Ctrl+C) innan du sparar till git. Medan appen kör håller den databasen öppen — då riskerar git att missa det senaste. Tillfälliga sidofiler (`.db-wal`, `.db-shm`) försvinner när servern stoppats och allt skrivits in i huvudfilen.
3. Commit och push (`data/bredehall.db` + `data/finance_config.json`).
4. Home Assistant: uppdatera add-on → **Återuppbygg** → **Starta om**.

**OBS:** Ändringar du bara gör via mobil/Tailscale följer inte med till git automatiskt. Gör ekonomiändringar på datorn om de ska sparas i repot.

CSV-arkivet (`data/finance/`) stannar på datorn (gitignored) — transaktionerna finns redan i databasen.

Repot innehåller riktig ekonomidata — håll det **privat** på GitHub.

## Konfiguration

### Home Assistant options

| Nyckel | Användning |
|--------|------------|
| `port` | Direkt webbport, standard `8765`. |
| `app_api_key` | API-nyckel för webb/API över LAN/Tailscale. |
| `openai_api_key` | Underhålls-AI: plananalys och bidragssökning. |
| `finance_storage_mode` | Initierar ekonomi-lagring (`local` eller `gdrive`) om `finance_config.json` saknas. Befintlig config skrivs inte över. |
| `google_calendar_credentials` | Finns i add-on schema, men nuvarande kalenderstöd är `.ics`-export via `/api/calendar/ical` och använder inte Google Calendar API. |

### `data/finance_config.json`

Följer med i git och styr ekonomiimporten:

| Nyckel | Användning |
|--------|------------|
| `storage_mode` | `local` läser `data/finance/inbox/<konto>/`; `gdrive` läser Google Drive-mappar. |
| `folder_map` | Konto → lokal inbox/Drive folder-id. Tomma Drive-id:n hoppas över i `gdrive`-läge. |
| `account_numbers` | Kontonummer per konto, används för kontodetektering och UI. |
| `archive_folder_id` | Drive-mapp för arkiv när `storage_mode=gdrive`. |
| `gdrive_credentials_path` | Valfri explicit sökväg till service-account JSON. Om tom testas `data/gdrive_credentials.json`, `/config/gdrive_credentials.json`, `/data/gdrive_credentials.json` eller env `GDRIVE_CREDENTIALS_PATH`. |
| `own_accounts_regex` | Regex för egna konton/överföringstext vid kategorisering och intern överföringsdetektering. |
| `csv_delimiter` | CSV-avgränsare, standard `;`. |
| `ai_enabled`, `ai_base_url`, `ai_api_key`, `ai_model` | Ekonomi-AI via OpenAI-kompatibel endpoint. |

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
