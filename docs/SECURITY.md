# Security

KAIDO's security model rests on one idea: **the model proposes, the runtime decides.**

## The trust boundary

```
   USER INSTRUCTIONS          ← instructions (trusted)
          │
   KAIDO POLICY / SYSTEM      ← instructions (trusted)
          │
        TOOLS  ──►  the Agent Runtime gate

   EXTERNAL CONTENT           ← DATA ONLY (untrusted)
   email · messages · notifications · issues · web pages · documents · files
```

External content can never grant a permission, change a policy, or issue an
instruction. `src/security/injection.ts` does two things about this:

1. **Detects** common injection patterns (instruction override, persona override,
   fake system blocks, exfiltration attempts, destructive commands, secret probes,
   bypass attempts, command injection) and records a finding.
2. **Defangs** the matched text and wraps the whole payload in an explicit
   `<<UNTRUSTED_*_DATA>>` boundary before it reaches a model.

Every agent system prompt also carries `UNTRUSTED_CONTENT_POLICY`, which states the
rule in plain language for the model.

## Permissions

Granular capabilities (`Permission` enum): `READ_EMAIL`, `SEND_EMAIL`, `READ_DRIVE`,
`WRITE_DRIVE`, `DELETE_DRIVE`, `READ_GITHUB`, `WRITE_GITHUB`, `READ_NOTIFICATIONS`,
`READ_CONTACTS`, `CAMERA`, `MICROPHONE`, `FILES_READ`, `FILES_WRITE`, `FILES_DELETE`,
`TERMUX_EXECUTION`, `MESSAGING_READ`, `MESSAGING_SEND`, `WEB_READ`, and more.

- Every tool declares the permissions it requires.
- Every agent holds its own explicit set.
- **A child agent never inherits the Master Agent's permissions.**
- The runtime checks the agent's set on every single call — a tool the agent was
  assigned but for which it lacks a permission is still denied.

## Risk engine

| Level | Examples | Default handling |
|---|---|---|
| LOW | search, read, analyse, summarise | runs silently |
| MEDIUM | draft, create issue, create calendar event, move file | runs silently under the default policy; conservative agents escalate |
| HIGH | send email, send message, delete file, push code | **confirmation required** |
| CRITICAL | financial actions, credential changes, bulk external communication | **confirmation required** |

Base risk is *escalated* by the runtime when the invocation has real-world shape:
`sideEffect` lifts the floor to MEDIUM, crossing a trust boundary lifts it to HIGH,
and `bulkOperation` / `financial` / `touchesCredentials` force CRITICAL. A read-shaped
tool used with write intent cannot slip through.

## Confirmation gates

When a policy requires confirmation, the runtime creates a `PendingConfirmation`
holding a **preview of the exact action** — agent, tool, and the arguments. The tool
is *not* executed. Approving re-runs it; denying records the refusal. The audit log
records both `CONFIRMATION_REQUESTED` and the resolution, so there is no such thing
as a silently executed sensitive action.

## Emergency stop

`kaido.stop()` marks the runtime stopped, resolves every pending confirmation, and
makes every subsequent `executeTool` return DENIED. The audit trail is preserved —
stopping KAIDO never destroys evidence. `kaido.resume()` clears it, and the resume
itself is audited.

## Command execution (Termux)

LLM-generated shell commands never execute freely. `validateTermuxCommand()` applies,
in order: a hard **denylist** (`rm -rf /`, `sudo`, `curl | sh`, `mkfs`, `dd if=`,
raw device writes, `iptables`, shutdown/reboot) → an **allowlist** of known-safe
development commands (`npm run build|test|lint|typecheck|check`, `npx tsc|tsx|…`,
`git status|log|diff|branch|show`, `git add|commit|push|pull|checkout|switch`, `ls`,
`cat`, `pwd`) → otherwise **refuse**. The default answer is no.

## Secrets

- No secret is ever hard-coded. All keys come from the environment.
- `.env` is git-ignored; `.env.example` documents the shape with empty values.
- Agent records contain prompts, tools and permissions — **never credentials**.
- Agent export/clone copies configuration only, never secrets.
- Logged detail is size-capped (2000 chars) and must be redacted by the caller.

## Other measures

- **Least privilege** — every agent starts with the minimum set; nothing is added on
  your behalf.
- **Memory isolation** — private by default; shared access is explicit per namespace.
- **Sensitive memory** — an agent may never auto-store a value it inferred; sensitive
  records require an explicit user-stated basis.
- **Auditability** — agent, task, tool, decision, risk and result on every action.

## Planned for phase 10

Android Keystore for token storage, SSRF protection on the web adapter, per-tool rate
limits, and tool sandboxing for the Android adapters. Tracked in ROADMAP.md.
