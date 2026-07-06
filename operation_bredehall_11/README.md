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

### Så synken fungerar

Vid add-on-start kör FastAPI `app.data_sync.sync_bundled_data()` innan tabeller, migreringar och seed-data initieras. Den jämför SHA-256 för filerna i add-on-bundlen (`/app/data`) mot den persistenta HA-volymen (`/data`) och kopierar bara när innehållet skiljer sig.

Synken omfattar bara:

- `bredehall.db`
- `finance_config.json`

Lokalt pekar appen på repots `data/`-mapp direkt, eftersom `/data` normalt inte finns. Om `DATA_DIR` är satt används den katalogen i stället.

### Rutin efter dataändringar

1. Gör ändringar lokalt på datorn.
2. Stoppa lokal uvicorn om den kör på någon devport:

   ```bash
   for port in 8890 8888 8876; do
     pid="$(lsof -ti tcp:$port || true)"
     [ -n "$pid" ] && kill "$pid"
   done
   ```

3. Skriv ihop SQLite WAL till huvudfilen innan commit:

   ```bash
   python - <<'PY'
   import sqlite3
   conn = sqlite3.connect("data/bredehall.db")
   conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
   conn.close()
   PY
   ```

4. Commit och push bara den kanoniska datan:

   ```bash
   git add data/bredehall.db data/finance_config.json
   git commit -m "Update canonical Bredehall data"
   git push
   ```

5. Home Assistant: uppdatera add-on → **Återuppbygg** → **Starta om**. Vid start kopieras git-versionen till `/data` om den skiljer sig.

**OBS:** Ändringar du bara gör via mobil/Tailscale följer inte med till git automatiskt. Gör ekonomiändringar på datorn om de ska sparas i repot.

Committa inte:

- `data/bredehall.db-wal`
- `data/bredehall.db-shm`
- `data/finance/` (CSV-inbox och arkiv)
- `data/gdrive_credentials.json`

CSV-arkivet (`data/finance/`) stannar på datorn (gitignored). Vid lokal CSV-import flyttas filer från `data/finance/inbox/<konto>` till `data/finance/archive/<konto>` först efter lyckad DB-insert; vid DB-fel ligger filerna kvar i inboxen.

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
