#!/data/data/com.termux/files/usr/bin/bash
# KAIDO — Termux setup script.
#
# Run this once inside Termux to get KAIDO running on your phone:
#
#   bash scripts/setup-termux.sh
#
# It installs Node if needed, installs dependencies, runs the tests, builds,
# and prints the exact next commands.
set -euo pipefail

say() { printf '\n\033[1;34m==>\033[0m %s\n' "$1"; }
warn() { printf '\n\033[1;33m[!]\033[0m %s\n' "$1"; }
die() { printf '\n\033[1;31m[x]\033[0m %s\n' "$1" >&2; exit 1; }

if [ ! -f package.json ]; then
  die "Run this from the KAIDO project root (package.json not found)."
fi

say "Checking Node"
if ! command -v node >/dev/null 2>&1; then
  warn "Node is not installed. Installing it now."
  pkg update -y
  pkg install -y nodejs-lts git
fi
node --version || die "Node install failed."

say "Installing dependencies"
npm install

say "Type check"
npm run typecheck

say "Tests"
npm test

say "Build"
npm run build

say "Done."
cat <<'EOF'

KAIDO is built. Next steps:

  1. See the agent system:
       KAIDO_AI_PROVIDER=mock node dist/cli.js status
       KAIDO_AI_PROVIDER=mock node dist/cli.js add-all-templates
       KAIDO_AI_PROVIDER=mock node dist/cli.js agents

  2. See what is actually mounted:
       KAIDO_AI_PROVIDER=mock node dist/cli.js adapters

  3. Set up your AI provider (never commit this file):
       cp .env.example .env
       # then edit .env and add GEMINI_API_KEY

  4. Start the Termux bridge so agents can run commands here:
       node dist/bridge.js --root "$HOME/projects" --token "$(openssl rand -hex 16)"
     Keep it alive with:  termux-wake-lock

  5. Check every command that is allowed before it runs:
       node dist/cli.js validate-command "npm run build"

EOF
