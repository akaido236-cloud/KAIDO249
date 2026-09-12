#!/data/data/com.termux/files/usr/bin/bash
# KAIDO — الخطوة 2: إنشاء ريبو GitHub باسم KAIDO249 ورفع المشروع بـ gh CLI.
#
# شغّله من داخل مجلد المشروع:
#   cd ~/kaido
#   bash scripts/kaido-2-push.sh
#
# ملاحظة: هذا السكربت ما يخزّن أي توكن في الملفات. gh يحفظ المصادقة في
# مخزنه الآمن الخاص فيه (~/.config/gh)، وهذا هو المكان الصحيح الوحيد.
set -euo pipefail

REPO_NAME="KAIDO249"
BRANCH="main"

say()  { printf '\n\033[1;34m==>\033[0m %s\n' "$1"; }
warn() { printf '\n\033[1;33m[!]\033[0m %s\n' "$1"; }
die()  { printf '\n\033[1;31m[x]\033[0m %s\n' "$1" >&2; exit 1; }

# ── 0) نتأكد إننا في المجلد الصحيح ──────────────────────────────────────────
if [ ! -f package.json ]; then
  die "شغّل السكربت من داخل مجلد المشروع (package.json مو موجود هنا)."
fi
if [ ! -d .git ]; then
  die "ما فيه مستودع git هنا. تأكد إنك فكيت الضغط صح."
fi
say "المجلد صحيح: $(pwd)"
echo "    عدد الإيداعات: $(git rev-list --count HEAD 2>/dev/null || echo 0)"

# ── 1) نثبّت gh و git إذا ناقصين ────────────────────────────────────────────
say "أتأكد من الأدوات المطلوبة"
if ! command -v git >/dev/null 2>&1; then
  warn "git مو مثبّت — راح أثبّته."
  pkg install -y git
fi
if ! command -v gh >/dev/null 2>&1; then
  warn "gh مو مثبّت — راح أثبّته."
  pkg install -y gh
fi
echo "    git: $(git --version)"
echo "    gh:  $(gh --version | head -1)"

# ── 2) المصادقة ─────────────────────────────────────────────────────────────
say "أتحقق من مصادقة GitHub"
if ! gh auth status >/dev/null 2>&1; then
  warn "ما أنت مسجّل دخول في gh."
  echo
  echo "راح نبدأ تسجيل الدخول. اختر:"
  echo "    GitHub.com  →  HTTPS  →  Login with a web browser"
  echo
  echo "راح يطلع لك كود، وتفتح موقع GitHub وتلصقه هناك. هذا هو الطريق الآمن."
  echo
  read -r -p "اضغط Enter للمتابعة، أو Ctrl+C للإلغاء... " _
  gh auth login --hostname github.com --git-protocol https --web
fi
if ! gh auth status >/dev/null 2>&1; then
  die "المصادقة ما نجحت. جرّب: gh auth login"
fi
say "مسجّل دخول بنجاح"
gh auth status 2>&1 | sed 's/^/    /'

# ── 3) نجهّز هوية git ───────────────────────────────────────────────────────
say "أجهّز هوية git"
if [ -z "$(git config --global user.name || true)" ]; then
  GH_USER="$(gh api user --jq .login 2>/dev/null || echo "")"
  if [ -n "$GH_USER" ]; then
    git config --global user.name "$GH_USER"
    echo "    user.name = $GH_USER"
  else
    read -r -p "اكتب اسمك لـ git: " NAME
    git config --global user.name "$NAME"
  fi
fi
if [ -z "$(git config --global user.email || true)" ]; then
  GH_EMAIL="$(gh api user --jq '.email // empty' 2>/dev/null || echo "")"
  if [ -n "$GH_EMAIL" ] && [ "$GH_EMAIL" != "null" ]; then
    git config --global user.email "$GH_EMAIL"
  else
    read -r -p "اكتب إيميلك لـ git: " EMAIL
    git config --global user.email "$EMAIL"
  fi
fi
echo "    user.name  = $(git config --global user.name)"
echo "    user.email = $(git config --global user.email)"

# ── 4) نتأكد إن الفرع main ──────────────────────────────────────────────────
say "أتأكد إن الفرع $BRANCH"
git branch -M "$BRANCH"
echo "    الفرع الحالي: $(git branch --show-current)"

# ── 5) ننشئ الريبو ونرفع ────────────────────────────────────────────────────
say "أنشئ الريبو $REPO_NAME على GitHub وأرفع الشغل"
echo "    (إذا الريبو موجود مسبقاً، راح نستخدمه بدل ما ننشئ واحد جديد)"

if gh repo view "$REPO_NAME" >/dev/null 2>&1; then
  warn "الريبو $REPO_NAME موجود مسبقاً — راح أدفع فيه."
  GH_USER="$(gh api user --jq .login)"
  if git remote get-url origin >/dev/null 2>&1; then
    git remote set-url origin "https://github.com/$GH_USER/$REPO_NAME.git"
  else
    git remote add origin "https://github.com/$GH_USER/$REPO_NAME.git"
  fi
  git push -u origin "$BRANCH"
else
  # --source=. يرفع الفرع الحالي مباشرة مع إنشاء الريبو
  gh repo create "$REPO_NAME" \
    --public \
    --source=. \
    --remote=origin \
    --push \
    --description "KAIDO — personal AI Agent Operating System"
fi

# ── 6) نتحقق فعلياً إن الرفع نجح ────────────────────────────────────────────
say "أتحقق من النتيجة"
REMOTE_URL="$(git remote get-url origin 2>/dev/null || echo "")"
if [ -z "$REMOTE_URL" ]; then
  die "ما فيه remote مضبوط — الرفع ما نجح."
fi
echo "    remote: $REMOTE_URL"

# نقارن آخر إيداع محلي بآخر إيداع على الريموت
LOCAL_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git ls-remote origin "refs/heads/$BRANCH" 2>/dev/null | cut -f1 || echo "")"

if [ "$LOCAL_SHA" = "$REMOTE_SHA" ]; then
  echo "    ✓ الرفع مؤكَّد: الريموت مطابق للمحلي ($LOCAL_SHA)"
else
  warn "الريموت ما يطابق المحلي."
  echo "      محلي : $LOCAL_SHA"
  echo "      ريموت: ${REMOTE_SHA:-<فارغ>}"
  die "الرفع ما اكتمل. جرّب: git push -u origin $BRANCH"
fi

say "تم بنجاح."
cat <<EOF

الريبو جاهز:
    $REMOTE_URL

الخطوة التالية — شغّل أول بناء للـ APK من التلفون:

  1. افتح: $REMOTE_URL/actions
  2. اختر "Android APK" من القائمة اليسار
  3. اضغط "Run workflow" → "Run workflow"
  4. انتظر لين يخلص، ونزّل الـ APK من قسم Artifacts

وبعدها في Termux، جهّز المشروع للعمل محلياً:

    bash scripts/setup-termux.sh

EOF
