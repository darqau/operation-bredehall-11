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
- API-anrop skickar nyckeln som `X-API-Key: <nyckel>` eller `Authorization: Bearer <nyckel>`.
- Publika vägar utan nyckel: `/`, `/health`, `/static/*`, `/api/auth/status`.
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

Viktiga fält:

| Fält | Används till |
|------|--------------|
| `storage_mode` | `local` läser CSV från `data/finance/inbox/<konto>`, `gdrive` hämtar via Google Drive-konfiguration. |
| `folder_map` | Konton som syns i UI och vilka inbox-mappar som skapas. Värdet är Drive folder id i `gdrive`-läge. |
| `account_numbers` | Visningsnummer för konton i dashboard/metasvar. |
| `own_accounts_regex` | Textsignal för egna konton vid klassning av interna överföringar. |
| `csv_delimiter` | Avgränsare vid import (`;` som standard). Ändra om bankexporten använder t.ex. komma. |
| `ai_enabled`, `ai_base_url`, `ai_api_key`, `ai_model` | OpenAI-kompatibel ekonomi-AI, ofta lokal LM Studio. Skild från add-on-fältet `openai_api_key`. |

## Ekonomi — import, API och felsökning

### Importflöde

1. Lägg CSV i `data/finance/inbox/<konto>/` eller ladda upp via `POST /api/finance/upload`.
2. `POST /api/finance/process` läser varje konto i `folder_map`, parsar bankrader och klassar `typ`/`category`.
3. Lyckad DB-insert flyttar lokala filer till `data/finance/archive/<konto>/`. Vid DB-fel lämnas filerna kvar i inboxen.
4. Efter import körs intern överföringsdetektion när nya transaktioner lagts till.

Parsern känner igen svenska bankfält som `Bokföringsdag`/`Datum`, `Belopp`, `Beskrivning`/`Text`, `Avsändare`, `Mottagare`, `Saldo` och `Valuta`. Dubbletter hoppas över för importerade rader med samma **konto + datum + belopp i ören + normaliserad beskrivning**. Manuella rader (`POST /api/finance/manual`) ingår inte i den dedupliceringen.

### Transaktioner och dashboard

`GET /api/finance/transactions` är list-API:t för tabeller och summeringar. Svaret innehåller `total`, `offset`, `limit`, `sum_amount` och `items`.

Exempel:

```bash
curl -H "X-API-Key: $APP_API_KEY" \
  "http://127.0.0.1:8890/api/finance/transactions?year=2026&category=Livsmedel&exclude_overforing=true&sort_by=amount&sort_dir=asc"
```

Filter som delas av transaktionslistan och dashboarden:

- `account`, `category`, `typ`
- `year` (används bara när `date_from`/`date_to` saknas)
- `date_from`, `date_to` (`YYYY-MM-DD`)
- `search` (matchar beskrivning; `%` och `_` escap:as)
- `exclude_overforing=true`
- `max_amount` (absolutbelopp, påverkar både lista och `sum_amount`)

Sortering i listan: `sort_by=txn_date|amount|description|account|category`, `sort_dir=asc|desc`, `limit=1..500`, `offset>=0`. `sum_amount` och `total` beräknas på samma filter som listan, men före paginering.

`GET /api/finance/dashboard` använder samma filter och har dessutom `chart_max_amount` (standard `100000`). Om `year` utelämnas visas alla år. Dashboardens kontosaldon är alltid senaste kända saldo per konto och påverkas inte av tabellfiltren. Diagrammen döljer stora engångsrader och brus: kategorierna `Överföring` och `Bostadsköp (engång)`, beskrivningar med `slutlikvid`, samt rader över `chart_max_amount`.

### Kategorisering, AI och lån

- Regelbaserad kategorisering sker vid import via `app/services/finance/categorizer.py`.
- `PATCH /api/finance/transactions/{id}/category` låser kategorin (`category_locked`). Med `apply_to_similar=true` uppdateras rader med exakt samma beskrivning; låsta beskrivningar lärs in och används vid framtida importer.
- Interna överföringar märks som `typ/category = Överföring` när en negativ och positiv rad med samma belopp finns på olika konton inom tre dagar och någon rad har överförings-/egen-konto-signal.
- Ekonomi-AI finns under `/api/finance/ai/*` och kräver `ai_enabled=true` i `finance_config.json`. Batchstorlek är 1-30 rader och osäkra svar (`confidence < 0.55`) lämnas som `Övrigt`.
- Lån/skulder hanteras via `/api/finance/loans*`. Text- och bildtolkning använder samma OpenAI-kompatibla AI-inställningar; bildtolkning kräver en vision-kapabel modell.

### Vanliga fallgropar

- Det persistenta `finance_config.json` styr ekonomi-läget. HA-optionen `finance_storage_mode` skriver inte över en befintlig fil; ändra via filen eller Inställningar.
- CSV-arkivet i `data/finance/archive/` ska inte committas; databasen innehåller importerade transaktioner.
- Om importen ger 0 rader: kontrollera `csv_delimiter`, rubrikraden och att datum/belopp finns i format parsern stödjer.
- Om tabellens summa och dashboardens graf skiljer sig: dashboard-grafen kan exkludera `chart_max_amount`, `slutlikvid` och engångskategorier även när transaktionslistan fortfarande visar raderna.

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
