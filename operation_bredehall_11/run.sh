#!/bin/sh
# Startscript för Operation Bredehall 11.
# Home Assistant anropar detta när add-on startar.
# Läs port och API-nyckel från options (config.json) om det finns; annars 8765.

set -e

PORT=8765
if [ -f /data/options.json ] || [ -f /config/options.json ]; then
  read PORT APP_KEY <<EOF
$(python3 <<'PY'
import json
from pathlib import Path
for p in ("/data/options.json", "/config/options.json"):
    fp = Path(p)
    if fp.is_file():
        o = json.loads(fp.read_text(encoding="utf-8"))
        print(o.get("port") or 8765)
        print((o.get("app_api_key") or "").strip())
        break
else:
    print(8765)
    print("")
PY
)
EOF
  if [ -n "$APP_KEY" ]; then
    export APP_API_KEY="$APP_KEY"
  fi
fi
PORT=${PORT:-8765}

cd /app
exec python3 -m uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
