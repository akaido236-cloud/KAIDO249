# KAIDO

**A personal AI Agent Operating System.**

KAIDO is not a chatbot. It is an agent platform: one Master Agent that understands
your request, plans, and delegates to specialised child agents — each with its own
tools, permissions, memory and confirmation policy — all executing through a single
gated runtime that audits everything it does.

```
                         KAIDO
                    MASTER AGENT
                         │
             ┌───────────┼───────────┐
             │           │           │
        KAIDO CODER  RESEARCHER   DEVOPS   …
             │           │           │
          Tools        Tools       Tools
          Memory       Memory      Memory
             │           │           │
             └───────────┼───────────┘
                         │
                    AGENT RUNTIME   ← every action passes through here
                         │
        ┌────────────────┼────────────────┐
        │                │                │
   Android Layer    Integrations      Automation
   (Termux,         (Gmail, Drive,    (Events, Rules,
    Files, Notifs)   GitHub, Web)      Schedules)
```

---

## Why it is built this way

An LLM never executes anything directly. It can only *request* a tool call, and the
**Agent Runtime** decides whether that request is allowed. Every call passes through,
in order:

```
emergency-stop check → tool exists → agent was assigned the tool
   → permission check → risk assessment → confirmation gate → execute → audit
```

This is the property that makes KAIDO safe to give real access to: the model's
output is a *proposal*, and the runtime is the authority.

---

## Status

This is the **Phase 1–3 foundation**, built and verified:

| Area | State |
|---|---|
| Project, build config, core type system | done |
| Agent Runtime (permission + risk + confirmation + audit) | done |
| Tool Registry (21 tools) | done |
| Agent Factory (create, version, clone, roll back, export) | done |
| Agent Registry (persistent, hierarchical) | done |
| Master Agent orchestrator (plan → delegate → collect) | done |
| Natural-language agent creation (propose → review → approve) | done |
| Memory system (private / shared / selective, isolated by default) | done |
| Automation engine + event bus | done |
| Prompt-injection defence | done |
| Termux command allowlist | done |
| AI provider abstraction (Gemini default, mock for offline/tests) | done |
| **Android app shell / Termux bridge / live cloud calls** | **phase 4+ — see ROADMAP** |

**Verified:** 37/37 tests pass, typecheck clean, build clean, CLI exercised end to
end. See [DEVELOPMENT.md](docs/DEVELOPMENT.md) for the exact commands.

**Honest limitation:** the cloud integration tools (Gmail, Drive, GitHub) are wired
to their official APIs but return `INTEGRATION_UNAVAILABLE` until credentials are
present, and the Android tools return `ADAPTER_NOT_MOUNTED` until the Android bridge
registers a real implementation. They never fabricate a result. This is deliberate —
see [INTEGRATIONS.md](docs/INTEGRATIONS.md).

---

## Quick start

```bash
git clone <your-repo-url> kaido && cd kaido
npm install
cp .env.example .env      # fill in GEMINI_API_KEY etc. — never commit .env

npm run typecheck         # tsc --noEmit
npm test                  # 37 tests
npm run build             # tsc → dist/
```

Try the CLI (the mock provider runs with no API key, so this works offline):

```bash
export KAIDO_AI_PROVIDER=mock
node dist/cli.js status
node dist/cli.js add-all-templates
node dist/cli.js agents
node dist/cli.js create-agent "Create an agent called KAIDO OIU CODER that helps me program. Give it GitHub, Termux and file access. It must ask before pushing."
node dist/cli.js validate-command "rm -rf /"     # REFUSED
```

With a real key, swap `mock` for `gemini` and `kaido ask "..."` will plan and
delegate for real.

---

## Core concepts

**Agents are configuration, not code.** A child agent is a JSON record — prompt,
tools, permissions, memory scope, confirmation policy. Creating an agent never
duplicates the application.

**Permissions are granular and never inherited.** A child agent holds exactly the
permissions assigned to it. It does not inherit the Master Agent's set, and it
cannot use a tool it was not given — both are enforced at the runtime, not in a
prompt.

**Risk decides who approves.** LOW actions (search, read, summarise) run silently.
HIGH and CRITICAL actions (send, push, delete, spend) stop at a confirmation gate
with a preview of the exact action — never a hidden one.

**External content is data.** Email, messages, notifications, issues, pages and
documents are wrapped as untrusted and can never override policy.

**Everything is audited.** Agent, task, tool, permission decision, risk, and result
are recorded, with size-capped redacted detail.

---

## Documentation

| Document | Covers |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, data flow, the execution path |
| [SECURITY.md](docs/SECURITY.md) | Trust boundary, permissions, risk, injection defence |
| [TOOLS.md](docs/TOOLS.md) | The tool registry and every built-in tool |
| [AGENTS.md](docs/AGENTS.md) | The agent model, hierarchy, chat, activity |
| [AGENT_FACTORY.md](docs/AGENT_FACTORY.md) | Templates, NL creation, versioning, cloning |
| [AUTOMATIONS.md](docs/AUTOMATIONS.md) | Event bus, triggers, conditions, actions |
| [INTEGRATIONS.md](docs/INTEGRATIONS.md) | Gmail, Drive, GitHub, Android, WhatsApp — honest limits |
| [ADAPTERS.md](docs/ADAPTERS.md) | Adapter layer, the Termux bridge, the allowlist, honest limits |
| [ANDROID.md](docs/ANDROID.md) | The Android shell, and building the APK from your phone |
| [TERMUX.md](docs/TERMUX.md) | The command allowlist and bridge design |
| [DEVELOPMENT.md](docs/DEVELOPMENT.md) | Build, test, verify, phase-by-phase workflow |
| [ROADMAP.md](docs/ROADMAP.md) | Phases 4–10 and what each adds |

---

## Non-negotiables

1. No fake functionality — an unavailable capability says so.
2. No invented APIs.
3. No bypassing Android permissions or app security.
4. No secrets in source; `.env` only.
5. No agent gets unrestricted access by default.
6. No LLM-generated shell command executes without validation.
7. External content never overrides system instructions.
8. Sensitive external actions require confirmation.
9. Memory is isolated by default.
10. Nothing is claimed to work until it has been verified.

---

## License

MIT — see [LICENSE](LICENSE).
