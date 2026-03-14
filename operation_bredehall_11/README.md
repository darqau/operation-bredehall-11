# Operation Bredehall 11

Smart underhållsplanerare för villan – Custom Add-on för Home Assistant (t.ex. HA Green).

## Steg 1 – Hello World

### Filstruktur

Se **STRUCTURE.md** för full översikt. Kärnan nu:

- `config.yaml` – Add-on metadata och options
- `Dockerfile` – Container-build
- `run.sh` – Startkommando (uvicorn)
- `app/main.py` – FastAPI-app (Hello World + DB-init)
- `app/database.py` – SQLite-setup
- `app/models.py` – Tabellmodell `Task`

### Installation som Custom Add-on på Home Assistant

1. Kopiera hela projektmappen till din HA-add-on-katalog, t.ex.:
   - **HA OS/Supervisor:** Lägg add-on i en repo som du lägger till under **Add-ons → Add-on store → Repositories**, eller använd **Samba share** och placera mappen under `/addons/` (beroende på hur du kör custom add-ons).
   - Vanligt sätt: skapa ett eget repo med struktur `repo/addon_slug/config.yaml`, `Dockerfile`, `run.sh` etc., och lägg till repot i HA.
2. Efter att repot är tillagt: **Add-ons → Operation Bredehall 11 → Install → Start**.
3. Öppna **Open Web UI** (port 8765) – du ska se:  
   `Hello from Operation Bredehall 11 – underhållsplaneraren kör!`

### Testa lokalt (utan Docker/HA)

```bash
cd "c:\AI\Projects\Operation Bredehall"
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8765
```

Öppna http://localhost:8765 – samma Hello World-meddelande. Databasen skapas under `data/bredehall.db` (lokalt).

### Nästa steg

När Steg 1 fungerar: backend (CRUD, filtrering), frontend (dashboard) och sedan seed-data + Google Calendar + AI-modul.
