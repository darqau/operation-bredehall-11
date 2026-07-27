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

## Ekonomi

Ekonomidelen samlar banktransaktioner, kategorier och lån i samma SQLite-databas som
underhållsplaneringen. Flödet är avsett för lokal granskning först och därefter git-sync
till Home Assistant.

### Importflöde

1. Konton och mappar ligger i `data/finance_config.json`.
2. CSV-filer läggs i `data/finance/inbox/<konto>` eller laddas upp via
   `POST /api/finance/upload`.
3. `POST /api/finance/process` parsar filerna, sätter `typ` och `category`, skriver rader
   till databasen och flyttar lokala filer till `data/finance/archive/<konto>` först efter
   lyckad DB-import.

Dedup för bankrader görs på konto, datum, belopp i öre och normaliserad beskrivning.
Manuella rader dedupliceras inte på samma sätt. Efter import körs intern
överföringsdetektion och matchade par märks som `Överföring`.

### Transaktioner och dashboard

`GET /api/finance/transactions` använder samma filter för listan, `total` och
`sum_amount`:

```text
/api/finance/transactions?account=Gemensamt&year=2026&category=Livsmedel&limit=50
```

Stödda filter är `account`, `category`, `typ`, `year`, `date_from`, `date_to`,
`search`, `exclude_overforing` och `max_amount`. Sortering stöder `txn_date`, `amount`,
`description`, `account` och `category`; `limit` är max 500.

`GET /api/finance/dashboard` använder samma analysfilter. Om `year` saknas visas alla år.
Diagrammen filtrerar dessutom bort `Överföring`, `Bostadsköp (engång)`, beskrivningar med
`slutlikvid` och rader över `chart_max_amount` (100000 som standard) så engångshändelser
inte dominerar graferna. Saldon och nettoförmögenhet hämtas från senaste bankrapporterade
saldo per konto plus sparade lån/skulder (`/api/finance/loans`).

### Kategorisering

- Regelmotorn finns i `app/services/finance/categorizer.py` och kan köras om med
  `POST /api/finance/recategorize?method=rules`.
- Inline-ändringar låser kategorin (`category_locked`) och återanvänds för framtida
  importer med exakt samma bankbeskrivning.
- `apply_to_similar` uppdaterar alla befintliga transaktioner med samma beskrivning.
- Valfri AI-kategorisering använder finansinställningarna i `finance_config.json`, inte
  underhållsmodulens OpenAI-inställning.

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
