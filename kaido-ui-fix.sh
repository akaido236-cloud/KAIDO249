#!/data/data/com.termux/files/usr/bin/bash
# KAIDO — إصلاح سطر واحد في kaido-ui.mjs
# الاستخدام:  cd ~/kaido && bash kaido-ui-fix.sh
set -uo pipefail
say(){ printf '\n\033[1;34m==>\033[0m %s\n' "$1"; }
ok(){  printf '\033[1;32m  ✓\033[0m %s\n' "$1"; }
die(){ printf '\n\033[1;31m[x]\033[0m %s\n' "$1" >&2; exit 1; }

F="kaido-ui.mjs"
[ -f "$F" ] || die "ما لقيت $F — شغّل السكربت من:  cd ~/kaido"

if grep -q "dataDir: process.env.KAIDO_DATA_DIR" "$F"; then
  ok "الإصلاح مطبَّق مسبقاً."; exit 0
fi

say "نسخة احتياطية"; cp "$F" "$F.bak"; ok "محفوظة في $F.bak"

say "أطبّق الإصلاح"
node -e '
const fs=require("fs");
const p="kaido-ui.mjs";
let s=fs.readFileSync(p,"utf8");
const old="const kaido = new Kaido({ adapters: true, projectRoot: process.env.KAIDO_TERMUX_PROJECT_ROOT || process.cwd() });";
if(!s.includes(old)){ console.log("SKIP: النسخة مختلفة — ما نلمسها."); process.exit(3); }
s=s.replace(old,"const kaido = new Kaido({ dataDir: process.env.KAIDO_DATA_DIR === \"null\" ? null : (process.env.KAIDO_DATA_DIR || \"./kaido-data\"), adapters: true, projectRoot: process.env.KAIDO_TERMUX_PROJECT_ROOT || process.cwd() });");
fs.writeFileSync(p,s); console.log("OK");
' || die "فشل — استعد من $F.bak"

grep -q "dataDir: process.env.KAIDO_DATA_DIR" "$F" || die "ما نفع. استعد من $F.bak"
node --check "$F" || die "خطأ صياغة. استعد من $F.bak"
ok "تم الإصلاح والتحقق"

printf '\n\033[1;32m  تم\033[0m\n\n'
printf 'شغّلها:\n\n    cd ~/kaido\n    set -a; source .env; set +a\n    KAIDO_UI_EXPOSE=true node kaido-ui.mjs\n\n'
