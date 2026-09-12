# Integrations

Every integration is built on an official, authorised mechanism. Where a capability
is not technically available, KAIDO says so — this document is the honest inventory.

## Current state

The integration **tools** are registered and fully gated (permissions, risk,
confirmation). The **live API calls** are phase 5–6. Until credentials are present,
each tool returns a truthful refusal:

| Tool family | Status | Returns until configured |
|---|---|---|
| `gmail.*` | tool registered, API call phase 5 | `INTEGRATION_UNAVAILABLE` |
| `drive.*` | tool registered, API call phase 5 | `INTEGRATION_UNAVAILABLE` |
| `github.*` | tool registered, API call phase 5 | `INTEGRATION_UNAVAILABLE` |
| `android.*` | tool registered, adapter phase 4 | `ADAPTER_NOT_MOUNTED` |
| `web.*` | tool registered, adapter to be mounted | `ADAPTER_NOT_MOUNTED` |
| `termux.execute` | validation live, bridge phase 4 | command validated, then `ADAPTER_NOT_MOUNTED` |

The CLI shows availability per tool:

```bash
node dist/cli.js tools
# gmail.search   LOW   not configured   Search the user's Gmail by query. Read-only.
```

**No tool ever fabricates a result.** If Gmail is not configured, KAIDO says Gmail is
not configured.

---

## Gmail

**Mechanism:** official Google OAuth + Gmail API. No IMAP scraping, no browser
automation of the web UI.

**Capabilities (target):** search, read, summarise, extract tasks, draft, send with
confirmation, search attachments.

**Credentials:** `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`.

**Security:** `SEND_EMAIL` is HIGH risk and always gated. Email bodies are wrapped as
untrusted data before reaching a model.

---

## Google Drive

**Mechanism:** official Google Drive API via OAuth.

**Capabilities (target):** search, read, create, update, move, organise, download and
upload authorised files.

**Credentials:** `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`,
`GOOGLE_DRIVE_REFRESH_TOKEN`.

**Security:** `drive.delete` is HIGH risk and gated.

---

## GitHub

**Mechanism:** official GitHub REST API with a personal access token or GitHub App.
Never through a third-party connector.

**Capabilities (target):** repositories, issues, pull requests, commits, Actions,
notifications, releases, search. Write operations respect risk policy.

**Credentials:** `GITHUB_TOKEN`, optionally `GITHUB_OWNER`.

**Scripting note:** for git/CI work from a shell, the native `git` and `gh` CLIs are
the right tools — the API tools here exist so agents can reason about GitHub, not to
replace your workflow.

---

## Android

**Mechanism:** official Android APIs behind runtime permissions, each as an
independent adapter. Nothing activates hardware silently.

| Capability | Mechanism | Notes |
|---|---|---|
| Notifications | `NotificationListenerService` | requires explicit user grant in system settings |
| Contacts | `ContactsContract` | minimum necessary data only — never the whole database to a model |
| Camera | `ACTION_IMAGE_CAPTURE` intent | user-facing capture only, never background |
| Files | `MediaStore` / SAF | scoped to what the user shared |
| Calendar | `CalendarContract` | read and write behind separate permissions |
| Location | `FusedLocationProvider` | explicit permission, foreground only |

**Phase 4 status.** The adapters that do not need a native Android shell are
live: `files` (scoped to a root), `web` (fetch + extract, SSRF-guarded), and
`termux` (the bridge). The Android-platform adapters — notifications, contacts,
calendar, camera, location — still return `ADAPTER_NOT_MOUNTED`, because they
genuinely need the Android shell from phase 4b. They are not stubbed with fake
data; they refuse.

---

## WhatsApp

**What KAIDO will do:** work with notification content Android legitimately exposes
to the user, or with messages the user shares directly. Classify, summarise,
detect urgency, extract tasks, draft replies.

**What KAIDO will never do:**
- bypass WhatsApp's end-to-end encryption;
- read or extract WhatsApp's private databases;
- steal or replay sessions;
- circumvent authentication or any security control.

**Honest limitation:** WhatsApp offers no official public API for a personal
assistant, and direct programmatic sending is not available through a legitimate
mechanism. If that remains true, KAIDO will say so plainly and offer the best
supported alternative — typically **drafting a reply for you to send yourself**, or
using Android's share sheet / intents where the user is present.

KAIDO will not claim a capability it does not have. This is a rule, not a preference.

---

## Messenger

Same posture as WhatsApp: supported APIs or legitimate Android mechanisms
(notification access), analysis and drafting, and no attempt to defeat application
security. Where a capability is unavailable, it is documented as unavailable.

---

## Web

**Mechanism:** a search provider plus page extraction. KAIDO will not bypass
authentication, CAPTCHA, access controls, security mechanisms or rate limits. When
human interaction is genuinely required, it stops and asks.

All extracted page content is untrusted data and is wrapped as such.

---

## Adding an integration

1. Add a provider module under `src/integrations/<name>/`.
2. Register its tools in `src/tools/builtin.ts` with honest `isAvailable()`.
3. Add credentials to `.env.example`.
4. Document the mechanism, the limits, and the failure mode here.
5. Test the unavailable path first — it is the one most integrations get wrong.
