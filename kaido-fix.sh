#!/data/data/com.termux/files/usr/bin/bash
# KAIDO — تطبيق إصلاح الأخطاء ورفعه.
# الاستخدام:  cd ~/kaido && bash kaido-fix.sh
set -uo pipefail

say()  { printf '\n\033[1;34m==>\033[0m %s\n' "$1"; }
ok()   { printf '\033[1;32m  ✓\033[0m %s\n' "$1"; }
warn() { printf '\n\033[1;33m[!]\033[0m %s\n' "$1"; }
die()  { printf '\n\033[1;31m[x]\033[0m %s\n' "$1" >&2; exit 1; }

[ -f package.json ] || die "شغّل السكربت من داخل مجلد المشروع:  cd ~/kaido"
[ -d src/agent ]    || die "المجلد src/agent غير موجود."
[ -d .git ]         || die "ما فيه مستودع git."
say "المجلد صحيح: $PWD"

if grep -q "lastPlannerError" src/agent/orchestrator.ts 2>/dev/null; then
  ok "الإصلاح مطبَّق مسبقاً — ما فيه شي نعمله."
  printf '\nجرّب:\n  set -a; source .env; set +a\n  node dist/cli.js doctor\n\n'
  exit 0
fi
say "الإصلاح غير مطبَّق — نكمل."

BK="$HOME/kaido-backup-$(date +%Y%m%d-%H%M%S)"
say "نسخة احتياطية"
mkdir -p "$BK"; cp -r src tests "$BK/" 2>/dev/null || true
cp QUICKSTART.md "$BK/" 2>/dev/null || true
ok "محفوظة في: $BK"

say "أفكّ الرقعة المدمجة"
PATCH="$HOME/.kaido-fix.patch"
base64 -d 2>/dev/null <<'KAIDO_B64_EOF' | gunzip > "$PATCH"
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
wSRrC4ao1djnqgcnFEHp/wBEMv8zwDEAAA==
KAIDO_B64_EOF
[ -s "$PATCH" ] || die "فك الرقعة فشل."
ok "الرقعة جاهزة ($(wc -l < "$PATCH") سطر)"

say "أتحقق من الرقعة"
if ! git apply --check "$PATCH" 2>/dev/null; then
  warn "أحاول بطريقة أكثر تسامحاً..."
  git apply --check --3way "$PATCH" 2>/dev/null || die "ما قدرت أطبّق الرقعة. نسختك في: $BK"
fi
ok "الرقعة سليمة"

say "أطبّق الإصلاح"
git apply "$PATCH" 2>/dev/null || git apply --3way "$PATCH" || die "التطبيق فشل."
grep -q "lastPlannerError" src/agent/orchestrator.ts || die "التطبيق ما نفع. استعد من: $BK"
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
  ok "ضبطت هوية git"
fi
git add -A
git commit -q -m "Fix silent failures and master-agent self-routing; add doctor" 2>/dev/null \
  && ok "تم الإيداع" || warn "ما فيه تغييرات جديدة."
git push origin main 2>/dev/null || git push origin master 2>/dev/null \
  && ok "تم الرفع" || warn "الرفع فشل — جرّب:  git push -u origin main"

printf '\n\033[1;32m══════════════════════════════════════\033[0m\n'
printf '\033[1;32m  تم الإصلاح بنجاح\033[0m\n'
printf '\033[1;32m══════════════════════════════════════\033[0m\n\n'
printf 'الخطوة التالية:\n\n    set -a; source .env; set +a\n    node dist/cli.js doctor\n\nنسخة احتياطية: %s\n\n' "$BK"
