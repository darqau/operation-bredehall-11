#!/bin/sh
# Startscript fÃ¶r Operation Bredehall 11.
# Home Assistant anropar detta nÃ¤r add-on startar.
# LÃ¤s port frÃ¥n options (config.json) om det finns; annars 8765.

set -e

CONFIG_PATH="/config/options.json"
if [ -f "$CONFIG_PATH" ]; then
  PORT=$(grep -o '"port":[^,}]*' "$CONFIG_PATH" 2>/dev/null | head -1 | sed 's/"port"://;s/"//g;s/ //g')
fi
PORT=${PORT:-8765}

cd /app
exec python3 -m uvicorn app.main:app --host 0.0.0.0 --port "$PORT"

