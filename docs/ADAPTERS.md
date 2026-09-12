# KAIDO — Termux Bridge

The bridge is how KAIDO runs commands on your phone when the agent runtime is
somewhere else (a cloud worker, the Android app, another machine). It is a
separate, small process you start inside Termux.

## The shape

```
KAIDO runtime  ──HTTP──▶  bridge (in Termux)  ──execFile──▶  your commands
   (anywhere)                 (your phone)                    (no shell)
```

## Start it on the phone

```bash
cd ~/kaido
node dist/bridge.js --root ~/projects
```

Options:

| Flag | Meaning | Default |
| --- | --- | --- |
| `--root`, `-r` | Directory commands run in. **Required.** | — |
| `--port`, `-p` | Port to listen on | `7077` |
| `--host` | Interface to bind | `127.0.0.1` |
| `--token` | Shared secret every request must present | none |
| `--allow` | Add one extra permitted program (repeatable) | none |

The bridge refuses to start without `--root`. There is no "run anywhere" mode.

To keep it alive while the screen is off, use Termux's own tooling:

```bash
termux-wake-lock
node dist/bridge.js --root ~/projects --token "$(cat ~/.kaido-bridge-token)"
```

## Point the runtime at it

On whatever machine runs KAIDO's agents:

```bash
export KAIDO_TERMUX_ENABLED=true
export KAIDO_TERMUX_BRIDGE_URL=http://<phone-ip>:7077
export KAIDO_TERMUX_BRIDGE_TOKEN=<the same secret>
```

Then confirm the runtime sees it:

```bash
kaido adapters
```

`termux` should read `MOUNTED`. If it reads `UNAVAILABLE`, the runtime cannot
reach the phone — check the IP, the port, and whether both devices are on the
same network.

## What a command goes through

A command is validated **twice** — once by the client before it is sent, and
again by the server before it runs. The server never trusts the client.

```
command
  ↓  parse (no shell)
  ↓  hard denylist         → refused with a readable reason
  ↓  structured allowlist  → program + argument rules
  ↓  execute (execFile, no shell, timeout, output cap)
  ↓  output returned flagged as UNTRUSTED
```

## Why there is no shell

Commands run through `execFile` with `shell: false`. Practically:

- There is no shell to inject into, so `ls; rm -rf /` is not "escaped" — it is
  **refused**, because `;` is a metacharacter.
- Pipes, redirects, and command substitution are all refused for the same
  reason. If a task needs a pipeline, it does not belong on this bridge.
- Arguments are split with a quote-aware parser, so `git commit -m "a message"`
  stays one argument with no shell involved.

## The allowlist

Permitted by default:

| Program | Permitted |
| --- | --- |
| `npm` | `run build\|test\|lint\|typecheck\|check\|start`, `ci`, `install`, `--version` |
| `npx` | `tsc`, `tsx`, `vitest`, `jest` |
| `node` | `--version`, or a single `.mjs`/`.cjs`/`.js` file |
| `git` | read: `status log diff branch show remote rev-parse` |
| `git` | write: `add commit push pull checkout switch restore` |
| `ls`, `pwd`, `cat`, `echo`, `which`, `find` | read-only, no `-exec`/`-delete` |

Hard-blocked regardless of allowlist: `rm -rf`, `sudo`, `mkfs`, `dd if=`,
writes to `/dev/sd*`, `iptables`, `shutdown`/`reboot`/`halt`, recursive
`chmod 777`/`chown -R` on `/`, fork bombs, and `curl … | sh`.

To permit something else, name it explicitly:

```bash
node dist/bridge.js --root ~/projects --allow ffmpeg
```

The extra program is admitted with safe-argument rules only — it does not
inherit any special trust, and no metacharacter rule is relaxed for it.

## Risk and confirmation

`termux.execute` is rated **HIGH** in the risk engine and requires confirmation.
Even a fully allowlisted command stops for approval unless a confirmed
automation rule pre-authorises that exact tool. A command being "safe enough to
permit" and "approved to run right now" are two different questions, and KAIDO
asks them separately.

## Honest limitations

- **Output is untrusted.** A build log can contain text that reads like an
  instruction. KAIDO wraps command output before a model sees it, but you should
  treat the content itself as data either way.
- **Localhost by default.** Binding to a LAN address exposes the bridge to your
  network. If you do, set `--token`, and prefer a private network.
- **No shell means no pipelines.** Chained commands must be separate calls.
- **Git write commands push to whatever remote the repo has configured.** The
  allowlist permits `git push`; the risk engine still gates it.
- **The bridge is a door into your phone.** Keep `--token` set whenever the
  bridge is not strictly on localhost, and stop it when you are done.
