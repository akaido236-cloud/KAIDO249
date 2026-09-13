#!/data/data/com.termux/files/usr/bin/bash
set -e

# شغّل هذا من داخل فولدر المشروع في Termux
ENV_FILE=".env"

if [ ! -f "$ENV_FILE" ]; then
  echo "ما لقيتش .env هنا. شغّل السكربت من فولدر المشروع." >&2
  exit 1
fi

if grep -q "^KAIDO_ADAPTERS=" "$ENV_FILE"; then
  sed -i 's/^KAIDO_ADAPTERS=.*/KAIDO_ADAPTERS=true/' "$ENV_FILE"
else
  echo "KAIDO_ADAPTERS=true" >> "$ENV_FILE"
fi

echo "تم: KAIDO_ADAPTERS=true في .env (محلي فقط، ما يتبعتش لـ git لأنه مستثنى في .gitignore)"

