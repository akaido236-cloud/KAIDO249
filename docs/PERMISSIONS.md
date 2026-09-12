# Permissions reference

Granular capabilities KAIDO can grant. An agent holds its own explicit set; it never
inherits another agent's.

## Catalogue

| Permission | Grants | Typical tools |
|---|---|---|
| `READ_EMAIL` | read and search mail | `gmail.search`, `gmail.read` |
| `DRAFT_EMAIL` | create drafts | `gmail.draft` |
| `SEND_EMAIL` | send mail | `gmail.send` |
| `READ_DRIVE` | read and search Drive | `drive.search` |
| `WRITE_DRIVE` | create/update Drive files | `drive.create` |
| `DELETE_DRIVE` | delete Drive files | `drive.delete` |
| `READ_GITHUB` | read repos, issues, Actions | `github.repositories`, `github.actions`, `github.issues` |
| `WRITE_GITHUB` | create issues, comments, PRs | `github.createIssue` |
| `PUSH_GITHUB` | push commits | (git bridge) |
| `READ_NOTIFICATIONS` | read notifications Android exposes | `android.notifications` |
| `READ_CONTACTS` | search contacts | `android.contacts` |
| `WRITE_CONTACTS` | modify contacts | — |
| `READ_CALENDAR` / `WRITE_CALENDAR` | read / modify calendar | — |
| `CAMERA` | capture a photo, user-facing only | `android.camera` |
| `MICROPHONE` | record audio, user-facing only | — |
| `LOCATION` | foreground location | — |
| `CLIPBOARD` | read/write clipboard | — |
| `FILES_READ` / `FILES_WRITE` / `FILES_DELETE` | file access | `android.files` |
| `TERMUX_EXECUTION` | run validated commands | `termux.execute` |
| `MESSAGING_READ` / `MESSAGING_SEND` | messaging (see limits) | — |
| `WEB_READ` / `WEB_WRITE` | read pages / submit forms | `web.search`, `web.extract` |

## How they are enforced

1. A tool declares the permissions it requires.
2. An agent holds an explicit list.
3. On every call, `PermissionManager.check(agentId, tool.permissions)` must pass for
   **all** required permissions, or the call is denied and audited.
4. An agent that was not assigned the tool is denied even if it somehow held the
   permission — two independent checks, not one.

## Default sets by template

| Agent | Permissions |
|---|---|
| KAIDO (Master) | none — it delegates |
| KAIDO CODER | READ_GITHUB, WRITE_GITHUB, TERMUX_EXECUTION, FILES_READ, WEB_READ |
| KAIDO RESEARCHER | WEB_READ, FILES_READ |
| KAIDO DEVOPS | READ_GITHUB, TERMUX_EXECUTION, WEB_READ |
| KAIDO EMAIL | READ_EMAIL, DRAFT_EMAIL, SEND_EMAIL |
| KAIDO PUBLISHER | WEB_READ, WRITE_GITHUB, WRITE_DRIVE |
| KAIDO WHATSAPP | READ_NOTIFICATIONS, READ_CONTACTS |
| KAIDO SECURITY | none — read-only audit access |
| KAIDO FILE | FILES_READ, FILES_WRITE, READ_DRIVE |

## Android runtime permissions (phase 4)

Each adapter maps to a real Android permission, requested visibly at the point of
use, never bundled at install time:

| Adapter | Android permission |
|---|---|
| Notifications | `BIND_NOTIFICATION_LISTENER_SERVICE` (user grants in system settings) |
| Contacts | `READ_CONTACTS` |
| Calendar | `READ_CALENDAR` / `WRITE_CALENDAR` |
| Camera | `CAMERA` |
| Microphone | `RECORD_AUDIO` |
| Location | `ACCESS_FINE_LOCATION` |
| Files | `READ_MEDIA_*` / SAF grants |

## Changing a permission

```ts
kaido.registry.setPermission(agentId, Permission.WRITE_GITHUB, true)   // grant
kaido.registry.setPermission(agentId, Permission.WRITE_GITHUB, false)  // revoke
```

Both the change and its effect on future calls are audited.
