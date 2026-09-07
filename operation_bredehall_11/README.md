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

## Data — en databas, samma överallt

All data (uppgifter, transaktioner, lån) ligger i **`data/bredehall.db`**. Filen ligger i git tillsammans med **`data/finance_config.json`**. Det är den enda källan — du behöver inte importera CSV igen när Home Assistant uppdateras.

| Var du öppnar appen | Vad som händer |
|---------------------|----------------|
| **Datorn** (`127.0.0.1:8890`) | Läser `data/bredehall.db` direkt |
| **Home Assistant / Tailscale** (`:8765`) | Får samma fil från git vid omstart (automatisk kopiering om innehållet skiljer sig) |

Vid add-on-start jämför appen SHA-256 för `bredehall.db` och `finance_config.json` i den bundlade git-kopian (`/app/data`) med HA:s persistenta `/data`. Om innehållet skiljer sig kopieras git-versionen till `/data` innan tabeller, migrationer och seed körs. Lokalt är `data/` redan runtime-mappen, så ingen kopiering görs.

### Rutin efter ändringar

1. Gör ändringar lokalt på datorn.
2. **Stoppa** lokal uvicorn innan du sparar till git (vanligtvis port `8890`, ibland `8888`/`8876`). Medan appen kör kan SQLite hålla de senaste skrivningarna i WAL-filen.
3. Skriv ihop databasen till huvudfilen:

   ```bash
   python -c 'import sqlite3; c=sqlite3.connect("data/bredehall.db"); c.execute("PRAGMA wal_checkpoint(TRUNCATE)"); c.close()'
   ```

4. Commit och push `data/bredehall.db` + `data/finance_config.json` om de ändrats.
5. Home Assistant: uppdatera add-on → **Återuppbygg** → **Starta om**.

**OBS:** Ändringar du bara gör via mobil/Tailscale följer inte med till git automatiskt. Gör ekonomiändringar på datorn om de ska sparas i repot.

Committa aldrig `data/bredehall.db-wal`, `data/bredehall.db-shm`, `data/finance/`, `__pycache__` eller `1.0.0`.

CSV-arkivet (`data/finance/`) stannar på datorn (gitignored) — transaktionerna finns redan i databasen. Importerade CSV-filer arkiveras först efter lyckad databasinsert.

Repot innehåller riktig ekonomidata — håll det **privat** på GitHub.

## Konfiguration

- **`data/finance_config.json`** — konton, mappar, AI (följer med i git)

## Ekonomi-API och vanliga flöden

Alla `/api/finance/*`-anrop kräver API-nyckel när `app_api_key`/`APP_API_KEY` är satt. Skicka den med `X-API-Key: <nyckel>` eller `Authorization: Bearer <nyckel>`. Publika undantag är `/`, `/health`, `/static/*` och `/api/auth/status`.

### CSV-import

1. `POST /api/finance/detect` kan testa vilken kontomapp en CSV hör till.
2. `POST /api/finance/upload` tar `multipart/form-data` med `file`, valfri `account` och `auto_process=true|false` (max 10 MB).
3. `POST /api/finance/process` läser filer i `data/finance/inbox/<konto>`, skriver transaktioner till SQLite och flyttar lyckade filer till `data/finance/archive/<konto>`.

Deduplicering för importerade rader görs per konto, datum, belopp i ören och normaliserad beskrivning. Manuella transaktioner (`POST /api/finance/manual`) undantas från CSV-dedupliceringen.

### Transaktionslistan

`GET /api/finance/transactions` returnerar:

```json
{
  "total": 42,
  "offset": 0,
  "limit": 100,
  "sum_amount": -1234.56,
  "items": []
}
```

`items`, `total` och `sum_amount` använder samma filter. `limit` och `offset` gäller bara `items`, så `sum_amount` summerar alla matchande rader före paginering.

| Parameter | Beteende |
|-----------|----------|
| `account`, `category`, `typ` | Exakta filter mot transaktionens konto/kategori/typ |
| `year` | Filtrerar hela året, men bara när `date_from` och `date_to` saknas |
| `date_from`, `date_to` | ISO-datum (`YYYY-MM-DD`), inklusiva gränser |
| `search` | Case-insensitive sökning i `description`; `%` och `_` behandlas som text |
| `exclude_overforing=true` | Exkluderar rader där `typ` är `Överföring` |
| `max_amount` | Tar bara med rader där `abs(amount) <= max_amount` |
| `sort_by` | `txn_date`, `amount`, `description`, `account` eller `category` |
| `sort_dir` | `asc` eller `desc` |
| `limit`, `offset` | Sidstorlek `1..500` och nollbaserad offset |

Exempel:

```bash
curl -H "X-API-Key: $APP_API_KEY" \
  "http://127.0.0.1:8890/api/finance/transactions?year=2026&exclude_overforing=true&sort_by=amount&sort_dir=asc&limit=50"
```

Dashboarden (`GET /api/finance/dashboard`) använder samma basfilter och har dessutom `chart_max_amount` för att dölja extrema rader i graferna. `GET /api/finance/hero` visar övergripande saldo, skulder och nettoförmögenhet.

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
