#!/bin/sh
# Startscript för Operation Bredehall 11.
# Home Assistant anropar detta när add-on startar.
# Läs port och API-nyckel från options (config.json) om det finns; annars 8765.

set -e

CONFIG_PATH="/config/options.json"
PORT=8765
if [ -f "$CONFIG_PATH" ]; then
  PORT=$(grep -o '"port":[^,}]*' "$CONFIG_PATH" 2>/dev/null | head -1 | sed 's/"port"://;s/"//g;s/ //g')
  APP_KEY=$(grep -o '"app_api_key":[^,}]*' "$CONFIG_PATH" 2>/dev/null | head -1 | sed 's/"app_api_key"://;s/"//g;s/ //g')
  if [ -n "$APP_KEY" ]; then
    export APP_API_KEY="$APP_KEY"
  fi
fi
PORT=${PORT:-8765}

cd /app
exec python3 -m uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
