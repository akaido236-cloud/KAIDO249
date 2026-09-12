# Development

Everything here works from Termux on Android. No PC required.

## Requirements

- Node.js 20+
- npm 10+
- git

Install in Termux:

```bash
pkg update && pkg upgrade
pkg install nodejs-lts git
```

## Setup

```bash
git clone <your-repo-url> kaido && cd kaido
npm install
cp .env.example .env
```

Edit `.env` and set at minimum `GEMINI_API_KEY` for real AI calls. Everything runs
without it using the mock provider.

## The verification loop

Run this after every change — it is the definition of "done" in this repo:

```bash
npm run typecheck    # tsc --noEmit — types
npm test             # node --test — 37 tests
npm run build        # tsc → dist/
```

Or all three:

```bash
npm run check
```

**Do not claim a change works until these pass and you have exercised the affected
CLI path.** That rule comes from KAIDO's own non-negotiables.

## Using the CLI

```bash
export KAIDO_AI_PROVIDER=mock        # no API key needed
node dist/cli.js status
node dist/cli.js add-all-templates
node dist/cli.js agents
node dist/cli.js tools
node dist/cli.js ask "check my latest build"
node dist/cli.js create-agent "Create an agent called X that does Y"
node dist/cli.js activity
```

With a real key:

```bash
export KAIDO_AI_PROVIDER=gemini GEMINI_API_KEY=...
node dist/cli.js ask "summarise my important emails from today"
```

## Running tests directly

```bash
npx tsx --test tests/*.test.ts                 # all
npx tsx --test tests/security.test.ts          # one file
npx tsx --test --test-name-pattern="permission" tests/*.test.ts
```

The suite is hermetic: it uses `MockProvider` and `dataDir: null`, so it touches no
network and writes no files.

## Project layout

See [ARCHITECTURE.md](ARCHITECTURE.md) for the source map and the execution path.

## Adding a feature — the order that works

1. Extend the type in `src/core/types.ts`.
2. Implement in the narrowest module that owns the concern.
3. Wire it in `src/index.ts` if it needs to be part of the assembly.
4. Add a CLI command if it is user-facing.
5. **Write the test first for anything security-relevant** — permission denial, risk
   escalation, confirmation gating, injection defence.
6. `npm run check`.
7. Exercise the CLI path.

## Working from the phone

- Termux, `git`, and the CLI are all you need for the core.
- The Android app (phase 4) needs the Android SDK and Gradle — build the APK in
  **GitHub Actions**, not on the phone.
- Keep `dist/` and `node_modules/` out of git (already ignored).

## CI

`.github/workflows/ci.yml` runs on every push and PR: install → typecheck → test →
build. Releases are phase 10.

## Reporting a phase

Each phase completion reports, in this order:

```
Implemented:      what now works
Files created:    new files
Files modified:   changed files
Dependencies:     added packages
Permissions:      Android permissions required, if any
Commands:         what was run
Tests:            what was verified
Build:            the result
Limitations:      what does not work yet
Next phase:       what follows
```
