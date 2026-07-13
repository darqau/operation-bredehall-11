# Operation Bredehall 11 – Filstruktur

## Översikt

```
operation_bredehall_11/
├── config.yaml              # HA add-on (direkt port 8765, app_api_key, options)
├── Dockerfile
├── run.sh                   # Startar uvicorn, exporterar HA options
├── requirements.txt
├── requirements-dev.txt     # pytest, httpx
├── README.md
├── tests/                   # pytest-grundsuite
│
├── app/
│   ├── main.py              # FastAPI, routers, startup-sync, migrationer
│   ├── data_sync.py         # /app/data från git → /data i HA-containern
│   ├── database.py          # SQLite + DATA_DIR
│   ├── migrations.py        # Idempotenta ALTER TABLE + WAL
│   ├── models.py            # Task, FinanceTransaction, FinanceLoan
│   ├── schemas.py           # Pydantic API-modeller
│   ├── crud.py              # Uppgifter
│   ├── crud_finance.py      # Transaktioner, lån, dedup, lärda kategorier, överföringar
│   ├── middleware/auth.py   # Valfri API-nyckel för LAN/Tailscale
│   │
│   ├── routers/             # tasks, finance, calendar (.ics), ai
│   ├── services/ai.py       # Underhålls-AI via HA openai_api_key
│   ├── services/finance/    # Ekonomiimport, dashboard, AI, config
│   ├── seed/
│   └── static/              # SPA (index.html, app.js, vendor/)
│
└── data/                    # I git: bredehall.db + finance_config.json
                             # Lokalt gitignored: finance/ CSV-arkiv
```

## Data

- **`bredehall.db`** + **`finance_config.json`** committas till git (privat repo)
- `Dockerfile` bundlar filerna till `/app/data`; `app.main.lifespan()` kör `data_sync.sync_bundled_data()` innan DB-init
- HA add-on: vid start kopieras bundlade filer till `/data` om SHA-256 skiljer sig; git-bundeln vinner
- Lokal dev läser/skriver samma `data/`-mapp — ingen separat databas
- Stoppa lokal server och checkpointa WAL innan commit så huvudfilen innehåller senaste SQLite-skrivning

## Finance-flöden

- `services/finance/config.py` läser `data/finance_config.json`, skapar lokala inbox/archive-mappar och synkar bara HA `finance_storage_mode` när config saknas
- `services/finance/processor.py` importerar CSV från lokala mappar eller Google Drive, applicerar lärda kategorier och flyttar lokala filer till arkiv efter lyckad DB-import
- `crud_finance.py` deduplicerar bankrader per konto + datum + belopp i öre + normaliserad beskrivning; manuella rader ingår inte i den dedupen
- `crud_finance.py` låser manuella kategoriändringar (`category_locked`) och kan applicera samma kategori på transaktioner med exakt samma beskrivning
- `detect_internal_transfers()` märker matchande debet/kredit mellan egna konton som `Överföring`, vilket dashboard-filter kan exkludera

## Publika API-ytor

- `/api/tasks/*` — CRUD och filtrering för underhållsuppgifter
- `/api/calendar/ical` — `.ics`-export av deadlines; ingen Google Calendar API-sync finns i nuläget
- `/api/ai/*` — underhållsanalys och bidragssökning med HA-option `openai_api_key`
- `/api/finance/*` — ekonomiimport, dashboard, transaktioner, kategorier, lån och ekonomi-AI
