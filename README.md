# Operation Bredehall — Home Assistant add-on repository

Det här repot följer [Home Assistants add-on-layout](https://developers.home-assistant.io/docs/add-ons/configuration/): rotmappen är **butiks-repot**, själva appen ligger i **`operation_bredehall_11/`**.

```
Operation Bredehall/          ← git-repo (repository.yaml)
└── operation_bredehall_11/   ← app + data + Docker/HA
    ├── app/
    ├── data/                 ← enda databasen lokalt (bredehall.db)
    ├── config.yaml           ← HA add-on-manifest
    ├── launch.py             ← Windows-start (8890)
    └── ...
```

## Var är vad?

| Plats | Syfte |
|-------|--------|
| **`operation_bredehall_11/`** | All kod, tester, launcher, databas |
| **`operation_bredehall_11/data/`** | SQLite + ekonomikonfig (+ lokalt CSV-arkiv) |
| **`repository.yaml`** | Registrerar repot i HA Add-on Store |

Det finns medvetet **inte** en separat `data/` i rot — den gamla tomma kopian är borttagen.

## Kom igång

```bash
cd operation_bredehall_11
pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8890
```

Windows: dubbelklicka **`Start Bredehall.exe`** i `operation_bredehall_11/`.

Se **`operation_bredehall_11/README.md`** för HA-installation, git-rutin och säkerhet.
