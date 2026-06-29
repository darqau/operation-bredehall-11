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

## Ekonomi: import och kategorisering

Ekonomidelen har en tydlig dataflödeskedja:

1. Konton definieras i `data/finance_config.json` (`folder_map` + `account_numbers`).
2. CSV-filer sparas per konto i `data/finance/inbox/<konto>/` via uppladdning eller lokal filkopiering.
3. Importen läser inboxen, skapar transaktioner i `data/bredehall.db` och flyttar lyckade filer till `data/finance/archive/<konto>/`.
4. Dashboard, kategorier och lån läser sedan bara från SQLite.

`data/finance/` är ett lokalt arbetsarkiv och ska inte committas. Det som ska sparas långsiktigt är databasen och `finance_config.json`.

### Vanligt importflöde

1. Lägg in konton under **Inställningar** i appen, eller direkt i `data/finance_config.json`.
2. Exportera CSV från banken.
3. Ladda upp filen i appen. Om kontonummer matchar `account_numbers` väljs konto automatiskt, annars behöver du välja konto.
4. Låt `auto_process` vara på, eller kör **Processa** efteråt.
5. Granska kategorin **Övrigt** och lås rätt kategori via kategorisidan. Välj "applicera på liknande" när samma bankbeskrivning ska få samma kategori framåt.
6. När ändringarna ska följa med till Home Assistant: stoppa lokal server så WAL skrivs in, commit/push `data/bredehall.db` och `data/finance_config.json`.

### CSV-format och begränsningar

- Uppladdning är begränsad till **10 MB per fil**.
- Parsern stödjer svenska bankexporter med `;` eller `,` som avgränsare.
- Vanliga kolumner som känns igen: `Bokföringsdag`/`Datum`/`Transaktionsdag`, `Belopp`, `Text`/`Beskrivning`/`Rubrik`/`Referens`, samt valfritt `Saldo`, `Avsändare`, `Mottagare`, `Valuta`.
- Kodningar som provas vid lokal import: `utf-8-sig`, `utf-8`, `cp1252`, `latin-1`.
- Dubbletter från CSV hoppas över per konto med nyckeln konto + datum + belopp i ören + normaliserad beskrivning. Manuella transaktioner räknas inte in i den dedupliceringen.
- Vid DB-fel flyttas lokala filer inte till arkivet; de ligger kvar i inboxen för ny körning.

### Kategorisering

- Regelbaserad kategorisering körs först och kräver ingen AI.
- Manuellt valda kategorier låses (`category_locked`) och används som inlärda exakta beskrivningsmatchningar vid senare importer.
- **Regelkör om** (`/api/finance/recategorize?method=rules`) hoppar över manuella/låsta rader och kan begränsas till `only_ovrigt=true`.
- Interna överföringar markeras som `Överföring` när motsatta belopp hittas på olika konton inom 3 dagar och text/egen-konto-regex ger stöd för att det är en egen överföring.
- AI-kategorisering är valfri. Den kräver `ai_enabled=true` och en OpenAI-kompatibel endpoint (`ai_base_url`, `ai_api_key`, `ai_model`). Förslag under confidence `0.55` lämnas som `Övrigt`.

### Google Drive-läge

`storage_mode = "gdrive"` i `finance_config.json` gör att importen läser CSV från Drive-mappar i `folder_map` (HA-option `finance_storage_mode` används bara när config skapas första gången). Det kräver service-account credentials via `gdrive_credentials_path`, miljövariabeln `GDRIVE_CREDENTIALS_PATH`, eller filen `data/gdrive_credentials.json`/`/data/gdrive_credentials.json`. Om `archive_folder_id` är satt flyttas Drive-filer dit efter hämtning.

För canonical data i git är lokal import enklast: kör importen lokalt, kontrollera resultatet i appen och committa bara SQLite/config-filerna.

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
