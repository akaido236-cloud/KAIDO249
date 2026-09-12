# Roadmap

Phases 1–3 are built and verified. Phases 4–10 are planned; nothing below claims to
exist until it does.

---

## Phase 1 — Foundation · DONE

- Project, build config, core type system
- AI provider abstraction (Gemini default, mock for offline/tests)
- Agent core, CLI, Kaido assembly
- **Verified:** typecheck clean, build clean, CLI runs

## Phase 2 — Agent Runtime · DONE

- Tool Registry (21 tools)
- Permission Manager (granular, non-inheriting)
- Risk Engine (escalation + policy)
- Audit Log (append-only JSONL)
- Agent Runtime — the single gated execution path
- **Verified:** 8 tests covering denial, gating, stop, audit

## Phase 3 — Agent Factory · DONE

- Create / edit / delete / enable / disable
- Versioning with rollback
- Cloning with isolation
- Agent chat routing (Master → child)
- Natural-language creation (propose → review → approve)
- Per-agent tools, permissions and memory
- **Verified:** full-system and factory tests pass

---

## Phase 4 — Termux + Android  ✅ (core complete)

Shipped:

- **Adapter layer** (`src/adapters/`) — the boundary between "tool registered"
  and "tool working". Reports true state; never fakes a result.
- **Termux bridge** — standalone server for Termux (`dist/bridge.js`) plus an
  HTTP/local client. Structured, shell-free allowlist; server re-validates every
  command; `execFile` with `shell: false`, timeout, output cap; optional shared
  token. Verified end to end: 11/11 bridge checks pass.
- **Files adapter** — scoped to a root, with path-escape prevention that is
  enforced rather than advisory.
- **Web adapter** — real fetch + HTML→text extraction, SSRF-guarded; search
  available when a provider is configured.
- **Command output and page text are untrusted** and wrapped before a model sees
  them.
- **`kaido adapters`** — reports the true state of every adapter.

Still to do (phase 4b):

- Android app shell (React Native or native — decided in-repo at phase start)
- Android platform adapters: notifications, contacts, calendar, camera, location
  — each needs an explicit, visible user grant
- APK build via GitHub Actions
- **Gate:** every adapter must work with an explicitly granted, visible permission

## Phase 5 — Cloud integrations

- Gmail API (OAuth) — search, read, draft, send
- Google Drive API (OAuth) — search, create, delete
- GitHub API — repos, actions, issues
- Replace `INTEGRATION_UNAVAILABLE` with live calls
- **Gate:** secrets in Android Keystore / encrypted storage, never in source

## Phase 6 — Messaging

- Notification listener → message events
- WhatsApp / Messenger analysis and drafting within the limits in INTEGRATIONS.md
- No attempt to defeat encryption or application security, ever

## Phase 7 — Automation

- Cron scheduler publishing `SCHEDULE_TICK`
- Webhook ingress
- Visual workflow builder (trigger / condition / agent / tool / approval / delay)
- **Gate:** approval nodes are first-class, not an afterthought

## Phase 8 — Multi-agent orchestration

- Parallel fan-out for read-shaped work only
- Hierarchical delegation (grandchildren)
- Shared task context between agents
- **Gate:** conflicting destructive operations are never parallelised

## Phase 9 — Memory

- Semantic search over memory
- Memory management UI (view / edit / delete / clear)
- Project and task-history namespaces

## Phase 10 — Hardening

- SSRF protection, per-tool rate limits, tool sandboxing
- Performance and battery budget for background work
- Offline mode surfacing (what is available / unavailable)
- Release pipeline: tag → APK → test → artifact → GitHub Release
- Penetration pass against the injection and permission surfaces

---

## Explicitly out of scope

- Bypassing any app's security, authentication or encryption
- Secret background hardware activation
- Unrestricted LLM shell execution
- Fabricating a capability that is not implemented

These are permanent exclusions, not deferred work.
