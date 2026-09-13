#!/data/data/com.termux/files/usr/bin/bash
set -e
ENV_FILE=".env"

if [ ! -f "$ENV_FILE" ]; then
  echo "ما لقيتش .env هنا. شغّل السكربت من فولدر المشروع." >&2
  exit 1
fi

if grep -q "^KAIDO_TERMUX_ENABLED=" "$ENV_FILE"; then
  sed -i 's/^KAIDO_TERMUX_ENABLED=.*/KAIDO_TERMUX_ENABLED=true/' "$ENV_FILE"
else
  echo "KAIDO_TERMUX_ENABLED=true" >> "$ENV_FILE"
fi

echo "تم: KAIDO_TERMUX_ENABLED=true في .env"

