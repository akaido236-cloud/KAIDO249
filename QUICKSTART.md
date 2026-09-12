# KAIDO — Quickstart

Three ways in, depending on what you want right now.

## 1. On your phone, in Termux (fastest)

```bash
pkg install -y nodejs-lts git
git clone <your-repo-url> kaido && cd kaido
bash scripts/setup-termux.sh
```

That installs, tests, and builds. Then:

```bash
KAIDO_AI_PROVIDER=mock node dist/cli.js add-all-templates
KAIDO_AI_PROVIDER=mock node dist/cli.js agents
```

## 2. Point it at a real model

```bash
cp .env.example .env
# edit .env, set GEMINI_API_KEY=...
export $(grep -v '^#' .env | xargs)   # or use your own env loader
KAIDO_AI_PROVIDER=gemini node dist/cli.js ask "what can you do?"
```

Never commit `.env`. It is in `.gitignore` already.

## 3. Build the Android APK (no PC needed)

1. Push the repo to GitHub.
2. Open the **Actions** tab → **Android APK** → **Run workflow**.
3. Leave the runtime URL blank for an inert shell, or enter one.
4. Download the APK from the run's **Artifacts** section.

## The commands you will actually use

| Command | What it does |
| --- | --- |
| `kaido status` | Runtime state: running, stopped, agents, pending approvals |
| `kaido tools` | Every tool, its risk level, and whether it is available |
| `kaido agents` | Your agents and their status |
| `kaido adapters` | Files / web / Termux — the **true** state of each |
| `kaido add-all-templates` | Instantiate the built-in agents |
| `kaido ask "<task>"` | Give the Master Agent a task |
| `kaido validate-command "<cmd>"` | Check a command against the Termux allowlist |
| `kaido stop` / `kaido resume` | Emergency stop and resume |

## Start the Termux bridge

```bash
termux-wake-lock
node dist/bridge.js --root "$HOME/projects" --token "$(openssl rand -hex 16)"
```

Then, wherever the agents run:

```bash
export KAIDO_TERMUX_ENABLED=true
export KAIDO_TERMUX_BRIDGE_URL=http://127.0.0.1:7077
export KAIDO_TERMUX_BRIDGE_TOKEN=<the same secret>
```

Full details in [docs/ADAPTERS.md](docs/ADAPTERS.md).
