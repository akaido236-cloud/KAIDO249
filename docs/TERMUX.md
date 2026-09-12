# Termux bridge

KAIDO is developed from an Android phone in Termux, so the bridge matters. It is
also the single most dangerous surface — an LLM asking to run shell commands. The
design treats it that way.

## The rule

**No LLM-generated command executes without passing validation.** A model's request
to run something is a proposal; the validator decides.

## Flow

```
command (proposed by an agent)
   ↓
validateTermuxCommand()
   ├─ empty / over 500 chars           → REFUSE
   ├─ matches a hard denylist pattern  → REFUSE
   ├─ matches an allowlist pattern     → ALLOW
   └─ otherwise                        → REFUSE  (default answer is no)
   ↓
permission check  (TERMUX_EXECUTION)
   ↓
risk assessment   (HIGH → confirmation required)
   ↓
confirmation gate (Allow Once / Always Allow / Cancel)
   ↓
execution via the bridge
   ↓
output → AI analysis (output is untrusted data)
```

Both layers exist on purpose. The allowlist stops a dangerous command; the
confirmation gate stops a *plausible* one you did not ask for.

## Denylist — refused outright

| Pattern | Why |
|---|---|
| `rm -rf /` | catastrophic deletion |
| `sudo` | privilege escalation |
| `curl … \| sh` | remote code execution |
| `chmod 777 /` | permission corruption |
| `mkfs` | filesystem destruction |
| `dd if=` | raw device writes |
| writes to `/dev/sd*` | raw device writes |
| `iptables` | network rule changes |
| `shutdown` / `reboot` / `halt` | hostile denial of service |

## Allowlist — permitted for development

```
npm run build|test|lint|typecheck|check
npx tsc|tsx|vitest|jest …
git status|log|diff|branch|show …
git add|commit|push|pull|checkout|switch …
ls, cat <file>, pwd
node --version, npm --version
```

A `git push` still hits the HIGH-risk confirmation gate, so allowlisting the command
shape does not authorise the push.

## Trying it

```bash
node dist/cli.js validate-command "npm run build"
# ALLOWED — Command matches the allowlist.

node dist/cli.js validate-command "rm -rf /"
# REFUSED — Command matches a hard-blocked dangerous pattern.

node dist/cli.js validate-command "some-unknown-binary --flag"
# REFUSED — Command is not on the allowlist. Add it explicitly if you trust it —
# KAIDO never executes arbitrary shell.
```

## Configuration

```
KAIDO_TERMUX_ENABLED=false          # set true only on your own device
KAIDO_TERMUX_PROJECT_ROOT=          # scope the bridge to one directory
```

## Extending the allowlist

Add a pattern to `TERMUX_ALLOWLIST` in `src/tools/builtin.ts` — deliberately a code
change, not a config toggle, so widening execution authority is always a reviewable
diff in version control.

## Phase 4 work

The bridge itself: an HTTP or Unix-socket endpoint inside Termux that receives a
validated command, runs it with a timeout in the scoped project root, captures
stdout/stderr, and returns it. The returned output is data — it is wrapped as
untrusted before any model reads it, because a build log from a compromised
dependency is not an instruction.
