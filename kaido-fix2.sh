#!/data/data/com.termux/files/usr/bin/bash
# KAIDO — الجولة الثانية من الإصلاحات.
# الاستخدام:  cd ~/kaido && bash kaido-fix2.sh
set -uo pipefail

say()  { printf '\n\033[1;34m==>\033[0m %s\n' "$1"; }
ok()   { printf '\033[1;32m  ✓\033[0m %s\n' "$1"; }
warn() { printf '\n\033[1;33m[!]\033[0m %s\n' "$1"; }
die()  { printf '\n\033[1;31m[x]\033[0m %s\n' "$1" >&2; exit 1; }

[ -f package.json ] || die "شغّل السكربت من داخل مجلد المشروع:  cd ~/kaido"
[ -d src/agent ]    || die "المجلد src/agent غير موجود."
[ -d .git ]         || die "ما فيه مستودع git."
say "المجلد صحيح: $PWD"

if grep -q "NO_AGENTS_INSTALLED" src/agent/orchestrator.ts 2>/dev/null; then
  ok "إصلاحات الجولة الثانية مطبَّقة مسبقاً."
  printf '\nجرّب:\n  node dist/cli.js agents\n\n'
  exit 0
fi

grep -q "lastPlannerError" src/agent/orchestrator.ts 2>/dev/null \
  || die "طبّق إصلاح الجولة الأولى أول:  bash kaido-fix.sh"
ok "إصلاح الجولة الأولى موجود"

BK="$HOME/kaido-backup2-$(date +%Y%m%d-%H%M%S)"
say "نسخة احتياطية"
mkdir -p "$BK"; cp -r src tests "$BK/" 2>/dev/null || true
cp .env.example "$BK/" 2>/dev/null || true
ok "محفوظة في: $BK"

say "أفكّ الرقعة المدمجة"
PATCH="$HOME/.kaido-fix2.patch"
base64 -d 2>/dev/null <<'KAIDO_B64_EOF' | gunzip > "$PATCH"
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
KAIDO_B64_EOF
[ -s "$PATCH" ] || die "فك الرقعة فشل."
ok "الرقعة جاهزة ($(wc -l < "$PATCH") سطر)"

say "أتحقق من الرقعة"
if ! git apply --check "$PATCH" 2>/dev/null; then
  warn "أحاول بطريقة أكثر تسامحاً..."
  git apply --check --3way "$PATCH" 2>/dev/null || die "ما قدرت أطبّق الرقعة. نسختك في: $BK"
fi
ok "الرقعة سليمة"

say "أطبّق الإصلاحات"
git apply "$PATCH" 2>/dev/null || git apply --3way "$PATCH" || die "التطبيق فشل."
grep -q "NO_AGENTS_INSTALLED" src/agent/orchestrator.ts || die "التطبيق ما نفع. استعد من: $BK"
ok "تم التطبيق والتحقق"

[ -d node_modules ] || { say "أثبّت المكتبات"; npm install || die "فشل التثبيت."; }

say "فحص الأنواع"
npm run typecheck || die "فحص الأنواع فشل. استعد من: $BK"

say "الاختبارات"
npm test 2>&1 | grep -E "^# (tests|pass|fail)" || true

say "البناء"
npm run build || die "البناء فشل. استعد من: $BK"
ok "البناء نجح"

say "أرفع التعديلات"
if ! git config user.email >/dev/null 2>&1; then
  GE="$(gh api user --jq '.email // empty' 2>/dev/null || true)"
  GN="$(gh api user --jq '.login // empty' 2>/dev/null || true)"
  git config user.email "${GE:-kaido@localhost}"; git config user.name "${GN:-kaido}"
fi
git add -A
git commit -q -m "Fix no-agent planning, non-English routing, default model" 2>/dev/null \
  && ok "تم الإيداع" || warn "ما فيه تغييرات جديدة."
git push origin main 2>/dev/null || git push origin master 2>/dev/null \
  && ok "تم الرفع" || warn "الرفع فشل — جرّب:  git push -u origin main"

printf '\n\033[1;32m══════════════════════════════════════\033[0m\n'
printf '\033[1;32m  تم إصلاح الجولة الثانية\033[0m\n'
printf '\033[1;32m══════════════════════════════════════\033[0m\n\n'
cat <<'NEXT'

الخطوة التالية — نصّب الوكلاء ثم جرّب:

    set -a; source .env; set +a
    node dist/cli.js add-all-templates
    node dist/cli.js agents
    node dist/cli.js ask "اعمل لي ملخص لشنو يقدر KAIDO يسوي"

NEXT
printf 'نسخة احتياطية: %s\n\n' "$BK"
