#!/data/data/com.termux/files/usr/bin/bash
# KAIDO — الخطوة 1: نقل الملف من التنزيلات إلى الهوم وفك الضغط.
#
# شغّله من Termux:
#   bash kaido-1-unpack.sh
#
# إذا كان مسار التنزيلات عندك مختلف، عدّل السطر DOWNLOADS تحت.
set -euo pipefail

ARCHIVE_NAME="KAIDO-AGENT.zip"
HOME_DIR="$HOME"
DOWNLOADS="$HOME/storage/downloads"   # المسار القياسي في Termux بعد termux-setup-storage

say()  { printf '\n\033[1;34m==>\033[0m %s\n' "$1"; }
warn() { printf '\n\033[1;33m[!]\033[0m %s\n' "$1"; }
die()  { printf '\n\033[1;31m[x]\033[0m %s\n' "$1" >&2; exit 1; }

# ── 0) صلاحية الوصول للتخزين ────────────────────────────────────────────────
if ! command -v unzip >/dev/null 2>&1; then
  printf '\n\033[1;33m[!]\033[0m unzip مو مثبّت — راح أثبّته.\n'
  pkg install -y unzip
fi

if [ ! -d "$DOWNLOADS" ]; then
  warn "ما لقيت مجلد التنزيلات في: $DOWNLOADS"
  warn "شغّل هذا الأمر أول، ووافق على الطلب اللي بيطلع:"
  echo
  echo "    termux-setup-storage"
  echo
  warn "بعدها شغّل السكربت مرة تانية."
  exit 1
fi

# ── 1) نتأكد إن الملف موجود ─────────────────────────────────────────────────
SRC="$DOWNLOADS/$ARCHIVE_NAME"
if [ ! -f "$SRC" ]; then
  warn "ما لقيت الملف: $SRC"
  echo
  echo "الملفات الموجودة في مجلد التنزيلات:"
  ls -1 "$DOWNLOADS" 2>/dev/null | head -30
  echo
  die "تأكد من اسم الملف، أو عدّل ARCHIVE_NAME في السكربت."
fi
say "لقيت الملف: $SRC  ($(du -h "$SRC" | cut -f1))"

# ── 2) ننسخه للهوم ──────────────────────────────────────────────────────────
DEST="$HOME_DIR/$ARCHIVE_NAME"
if [ -f "$DEST" ]; then
  warn "الملف موجود مسبقاً في الهوم — راح أستبدله."
fi
say "أنسخ إلى: $DEST"
cp -f "$SRC" "$DEST"
echo "    تم النسخ ($(du -h "$DEST" | cut -f1))"

# ── 3) نتحقق إن الملف سليم ──────────────────────────────────────────────────
say "أتحقق من سلامة الأرشيف"
if ! unzip -tqq "$DEST" >/dev/null 2>&1; then
  die "الأرشيف تالف — نزّل الملف مرة تانية."
fi
echo "    الأرشيف سليم."

# ── 4) نفك الضغط ────────────────────────────────────────────────────────────
if [ -d "$HOME_DIR/kaido" ]; then
  warn "مجلد kaido موجود مسبقاً في الهوم."
  warn "راح أنقله إلى kaido-old-<التاريخ> قبل ما أفك الضغط، عشان ما نخسر شي."
  mv "$HOME_DIR/kaido" "$HOME_DIR/kaido-old-$(date +%Y%m%d-%H%M%S)"
fi

say "أفك الضغط في $HOME_DIR"
cd "$HOME_DIR"
unzip -q "$DEST"
echo "    تم فك الضغط."

# ── 5) نتأكد إن النتيجة صحيحة ───────────────────────────────────────────────
PROJECT="$HOME_DIR/kaido"
if [ ! -f "$PROJECT/package.json" ]; then
  warn "ما لقيت package.json في $PROJECT"
  echo "المحتوى اللي طلع:"
  ls -1 "$HOME_DIR" | head -20
  die "شكل المجلد غير متوقّع."
fi

say "تم بنجاح."
cat <<EOF

المشروع صار في:  $PROJECT

عدد الملفات:     $(find "$PROJECT" -type f -not -path '*/.git/*' | wc -l)

الخطوة التالية — ربطه بـ GitHub ورفعه:

    cd $PROJECT
    bash scripts/kaido-2-push.sh

EOF
