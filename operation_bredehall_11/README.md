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

## Ekonomi — import, API och dashboard

Ekonomimodulen gör bank-CSV till sökbara transaktioner i samma SQLite-databas som
underhållsuppgifterna. CSV-filer är bara importkällor; efter lyckad import är
`data/bredehall.db` den viktiga filen.

### Konfiguration och mappar

`data/finance_config.json` styr import och kategorisering:

| Nyckel | Används till |
|--------|--------------|
| `storage_mode` | `local` läser `data/finance/inbox/<konto>`, `gdrive` läser Drive-mappar |
| `folder_map` | Kontonamn → Drive folder id; kontonamnet blir även lokal inbox-mapp |
| `account_numbers` | Visas i UI och används vid automatisk kontoigenkänning |
| `own_accounts_regex` | Hjälper reglerna hitta egna överföringar |
| `csv_delimiter` | Standard `;` |
| `ai_*` | OpenAI-kompatibel finance-AI för kategorisering/lånetolkning |

`GET /api/finance/config` maskar känsliga fält och returnerar i stället
`has_ai_api_key` och `has_gdrive_credentials`. `PUT /api/finance/config` tar bara
de fält som ska ändras; skicka `ai_api_key: "__UNCHANGED__"` för att lämna
befintlig nyckel orörd.

### CSV-import

Lokalt läggs filer i `data/finance/inbox/<konto>`. Via API kan samma flöde köras
med multipart-upload:

```bash
curl -X POST http://127.0.0.1:8890/api/finance/upload \
  -F "file=@nordea.csv" \
  -F "account=Gemensamt konto" \
  -F "auto_process=true"
```

- `POST /api/finance/detect` testar vilket konto en CSV verkar tillhöra.
- `POST /api/finance/upload` sparar filen i rätt inbox och kör import direkt när
  `auto_process=true` (default). Om `account` saknas krävs en tydlig automatisk
  träff; annars returneras 422 med kandidater.
- Maxstorlek för uppladdning är 10 MB.
- Filnamn saneras, får `.csv` vid behov och görs unika i inboxen.
- `POST /api/finance/process` importerar alla väntande filer enligt
  `storage_mode`.

Vid lokal import flyttas CSV-filen till `data/finance/archive/<konto>` först
efter att databasen har skrivit klart. Vid DB-fel lämnas filerna kvar i inboxen.
Importerade bankrader dedupliceras per konto, datum, belopp i ören och
normaliserad beskrivning. Manuella rader (`POST /api/finance/manual`) är inte en
del av CSV-dedupliceringen.

### Transaktioner

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

Filter som stöds: `account`, `category`, `typ`, `year`, `date_from`, `date_to`,
`search`, `exclude_overforing` och `max_amount`. `date_from`/`date_to` skrivs som
ISO-datum; om något datumfilter finns ignoreras `year`. `search` matchar
beskrivning och escaper SQL-wildcards. `max_amount` filtrerar på absolutbelopp.

Sortering och paginering:

- `sort_by`: `txn_date`, `amount`, `description`, `account`, `category`
- `sort_dir`: `asc` eller `desc`
- `limit`: 1–500, `offset`: 0 eller större

`total` och `sum_amount` använder samma filter som listan men påverkas inte av
`limit`/`offset`. Enstaka rader kan tas bort med
`DELETE /api/finance/transactions/{id}`. Mass-radering finns bara som dold
dev-endpoint och kräver `ALLOW_WIPE=1`.

### Dashboard och nyckeltal

- `GET /api/finance/meta` listar konton, kategorier, typer, år, datumspann och
  totalt antal transaktioner.
- `GET /api/finance/dashboard` använder samma filterfamilj som transaktionslistan
  plus `chart_max_amount` (default `100000`). Om `year` saknas visas hela
  historiken.
- Tidsserierna exkluderar `Överföring`, `Bostadsköp (engång)`, beskrivningar med
  `slutlikvid` och transaktioner vars absolutbelopp överskrider
  `chart_max_amount`. Svaret innehåller `chart_excludes` med aktiv gräns och hur
  många rader som kapades av beloppsgränsen.
- Kontosaldon i dashboarden hämtas från senaste bankrapporterade saldo per konto
  och är alltid en översikt över alla konton, även när transaktionsfilter används.
- `GET /api/finance/hero` summerar tillgångar, skulder, nettoförmögenhet,
  genomsnittligt månadsnetto och största utgiftskategorier. `exclude_internal`
  är `true` som default och tar bort `Överföring` från inkomst/netto.

### Kategorier, AI och lån

- `GET /api/finance/categories` visar tillåtna kategorier i svensk sortering.
- `PATCH /api/finance/transactions/{id}/category` validerar kategorin och låser
  raden. `apply_to_similar=true` uppdaterar alla rader med exakt samma
  beskrivning.
- Låsta kategorier lärs in som exakta beskrivningsmatchningar för framtida
  CSV-importer och ignoreras av regelbaserad omkategorisering.
- Finance-AI använder `finance_config.json` (`ai_base_url`, `ai_api_key`,
  `ai_model`) och är separerad från underhålls-AI:n under `/api/ai/*`.
- Lån/skulder hanteras via `/api/finance/loans`. `POST /loans/upsert` matchar på
  `account_number`; samma flöde används efter AI-tolkning av text eller bild.

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
