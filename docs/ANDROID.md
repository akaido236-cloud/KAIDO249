# KAIDO — Android shell

The Android shell is a thin client. It does **not** contain the agent brain —
that lives in the TypeScript core and runs wherever you point it (a cloud
worker, Termux on the phone, or the same device).

```
┌─────────────────────┐        ┌──────────────────────────┐
│  KAIDO (Android)     │  HTTPS │  KAIDO runtime (core)     │
│  WebView shell       │ ─────▶ │  agents · tools · policy  │
│  no dangerous perms  │        │  permissions · audit      │
└─────────────────────┘        └──────────────────────────┘
                                          │
                                          ▼
                               ┌──────────────────────────┐
                               │  Termux bridge (the phone)│
                               └──────────────────────────┘
```

## Why a shell and not the whole app in Kotlin

One core, one set of rules. If the agent logic lived in the APK, every policy
change would mean rebuilding and sideloading. Keeping it in the core means a
fix ships once and the shell just renders it.

## Building the APK from your phone (no PC)

You do not need a laptop. The APK is built by GitHub Actions:

1. Push to the repo (or open the **Actions** tab).
2. Choose the **Android APK** workflow.
3. Tap **Run workflow**.
4. Optionally enter a runtime URL. Leave it blank to build an inert shell.
5. When it finishes, download the APK from the run's **Artifacts** section.
6. Install it on the phone (you will need to allow install from your browser or
   file manager the first time).

The build also runs automatically on any push that touches `android/`.

## The shell ships inert on purpose

With no `kaidoRuntimeUrl` set, the app opens a status page stating plainly which
capabilities it does *not* hold. That is deliberate: an APK that silently points
at an arbitrary server, or that asks for the camera before you have seen it ask,
is exactly what KAIDO's rules forbid.

To build with a runtime URL:

```
gradle assembleDebug -PkaidoRuntimeUrl="https://your-runtime.example"
```

## Permissions in this shell

| Permission | Why |
| --- | --- |
| `INTERNET` | Reach the KAIDO runtime. That is all. |

**Not requested, on purpose:** camera, microphone, contacts, calendar, location,
files, and notification-listener access. Each of those arrives in its own shell,
behind its own visible OS permission prompt, so you always know what is being
asked for and can refuse it.

`android:allowBackup="false"` and cleartext traffic is disabled, so nothing
leaves the device unencrypted.

## Adding a capability later

To add camera access, for example:

1. Add `android.permission.CAMERA` to the manifest.
2. Implement an adapter in the shell that calls it.
3. Register it with the runtime over the bridge.
4. Add a permission constant and a confirmation requirement in the core.

The core will then require that permission before the tool can run, and the
risk engine will gate the action. The OS prompt and the KAIDO permission are
two separate gates, and both must open.

## Honest limitations

- **One Activity.** There is no multi-screen navigation yet.
- **No background work.** Automations on the phone need a foreground service or
  WorkManager, which is not built yet.
- **No signing key configured.** `assembleDebug` produces a debug APK. A release
  build needs a keystore, which must live in GitHub Secrets — never in the repo.
- **The bridge is a separate process.** The shell does not start it; you run it
  in Termux.
