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

## Ekonomi: import, filter och summeringar

Ekonomidelen utgår från konton i **`data/finance_config.json`**. Varje konto får en lokal inbox under `data/finance/inbox/<konto>` och arkiv under `data/finance/archive/<konto>`. CSV-arkivet är gitignored; när importen lyckas är databasen den sparade sanningen.

### CSV-import

- `POST /api/finance/detect` försöker hitta konto från filnamn/innehåll.
- `POST /api/finance/upload` tar en CSV-fil (max 10 MB), skapar konto vid behov och kör import direkt om `auto_process=true`.
- `POST /api/finance/process` läser alla lokala inbox-mappar, skriver transaktioner till SQLite och flyttar filer till arkiv först efter lyckad DB-import.
- `storage_mode=gdrive` hämtar i stället CSV via Google Drive-konfigurationen.

Dubbletter hoppas över per konto med fingeravtrycket `datum + belopp i ören + normaliserad beskrivning`. Manuella transaktioner (`POST /api/finance/manual`) räknas inte som CSV-dubbletter.

### Transaktions-API

`GET /api/finance/transactions` returnerar:

```json
{
  "total": 123,
  "offset": 0,
  "limit": 100,
  "sum_amount": -4567.89,
  "items": []
}
```

Filter gäller för både `items`, `total` och **`sum_amount`** innan paginering:

| Parameter | Beteende |
|-----------|----------|
| `account`, `category`, `typ` | Exakt matchning |
| `year` | Hela året, men bara om `date_from`/`date_to` saknas |
| `date_from`, `date_to` | ISO-datum, inkluderande intervall |
| `search` | Söker i beskrivning; `%` och `_` behandlas som vanlig text |
| `exclude_overforing=true` | Tar bort `typ="Överföring"` |
| `max_amount` | Tar bara rader där `abs(amount) <= max_amount` |
| `sort_by` | `txn_date`, `amount`, `description`, `account`, `category` |
| `sort_dir` | `asc` eller `desc` |
| `limit`, `offset` | `limit` är 1-500 |

Exempel:

```text
/api/finance/transactions?year=2026&category=Mat&exclude_overforing=true&limit=50
/api/finance/transactions?date_from=2026-01-01&date_to=2026-03-31&search=ica
```

### Dashboard och nyckeltal

- `GET /api/finance/dashboard` använder samma grundfilter som transaktionslistan plus `chart_max_amount`.
- Om `year` saknas visas alla år i graferna.
- Diagrammen filtrerar bort kategorierna `Överföring` och `Bostadsköp (engång)`, texter som innehåller `slutlikvid`, samt rader över `chart_max_amount`.
- Senaste banksaldo per konto och kontohistorik är avsiktligt ofiltrerade översikter.
- `GET /api/finance/hero` summerar tillgångar, skulder och nettoförmögenhet; interna överföringar exkluderas från netto/inkomst/utgift som standard.

## Data — en databas, samma överallt

All data (uppgifter, transaktioner, lån) ligger i **`data/bredehall.db`**. Filen ligger i git tillsammans med **`data/finance_config.json`**. Det är den enda källan — du behöver inte importera CSV igen när Home Assistant uppdateras.

| Var du öppnar appen | Vad som händer |
|---------------------|----------------|
| **Datorn** (`127.0.0.1:8890`) | Läser `data/bredehall.db` direkt |
| **Home Assistant / Tailscale** (`:8765`) | Får samma fil från git vid omstart (automatisk kopiering om innehållet skiljer sig) |

### Rutin efter ändringar

1. Gör ändringar lokalt på datorn.
2. **Stoppa** den lokala servern innan du sparar till git. Medan appen kör håller SQLite-databasen öppen — då riskerar git att missa det senaste.
3. Skriv ihop WAL till huvudfilen om databasen varit öppen (kör från `operation_bredehall_11/`):
   ```bash
   python -c "import sqlite3; c=sqlite3.connect('data/bredehall.db'); c.execute('PRAGMA wal_checkpoint(TRUNCATE)'); c.close()"
   ```
4. Kontrollera att du bara committar `data/bredehall.db` och vid behov `data/finance_config.json` — aldrig `data/bredehall.db-wal`, `data/bredehall.db-shm` eller `data/finance/`.
5. Commit och push.
6. Home Assistant: uppdatera add-on → **Återuppbygg** → **Starta om**.

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
