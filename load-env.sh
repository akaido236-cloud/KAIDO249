#!/data/data/com.termux/files/usr/bin/bash
set -e

FILE="src/cli.ts"
if [ ! -f "$FILE" ]; then
  echo "شغّل السكربت من جذر المشروع (وين موجود src/cli.ts)." >&2
  exit 1
fi

if grep -q "loadDotEnv" "$FILE"; then
  echo "التحميل موجود مسبقًا، ما لزمش تعديل."
else
  # نضيف كود بسيط يقرا .env يدويًا بلا حاجة لباكدج dotenv
  python3 - "$FILE" << 'PYEOF'
import sys
path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

anchor = "import { Kaido } from './index.js';"
inject = """import fs from 'node:fs';
import path from 'node:path';

function loadDotEnv(): void {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\\r?\\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadDotEnv();

import { Kaido } from './index.js';"""

content = content.replace(anchor, inject, 1)
with open(path, "w", encoding="utf-8") as f:
    f.write(content)
PYEOF
  echo "تم تعديل $FILE ليقرا .env تلقائيًا."
fi

npm run build

git add -A
git commit -m "fix: load .env automatically in CLI so KAIDO_ADAPTERS/KAIDO_TERMUX_ENABLED are respected"
git push

echo "تم البناء والدفع. جرب: node dist/cli.js adapters"

