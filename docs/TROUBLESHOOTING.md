# Troubleshooting

## "GEMINI_API_KEY is not set"

Expected until you configure it. Two options:

```bash
export KAIDO_AI_PROVIDER=mock          # deterministic, offline, no key
# or
cp .env.example .env && $EDITOR .env   # set GEMINI_API_KEY
```

The mock provider is not a degraded mode for development — it is what the test suite
uses to stay hermetic.

## "INTEGRATION_UNAVAILABLE"

The tool is working correctly; its backing service has no credentials. Check
`.env` for the matching keys and see [INTEGRATIONS.md](INTEGRATIONS.md). A tool that
cannot reach its service says so rather than inventing a result — this is by design.

## "ADAPTER_NOT_MOUNTED"

The tool needs a platform adapter that is not registered in this runtime. Android
adapters arrive in phase 4, web adapters when mounted. Nothing is wrong with your
setup; the capability simply is not built yet.

## "COMMAND_REFUSED"

The command was not on the Termux allowlist, or matched a hard-blocked pattern.

```bash
node dist/cli.js validate-command "npm run build"   # to see the verdict
```

To add a legitimate command, extend `TERMUX_ALLOWLIST` in `src/tools/builtin.ts`.
The default answer is no, deliberately: see [TERMUX.md](TERMUX.md).

## "Missing permissions: X"

The agent does not hold a permission its tool requires. Grant it explicitly, or
assign a tool the agent is allowed to use.

```ts
kaido.registry.setPermission(agentId, Permission.WRITE_GITHUB, true)
```

Do not work around this by widening a prompt — the check is in the runtime and a
prompt cannot change it. That is the point.

## "Agent X is not assigned the tool Y"

The agent's `tools` array does not include that tool. Add it in the agent spec, or
let the Master Agent route the task to an agent that has it.

## Every action is asking for approval

That is the confirmation gate working. A tool at or above a level in the agent's
`confirmationPolicy.requireConfirmationFor` always asks. To reduce prompts, use a
narrower agent with read-only tools, or (deliberately) record a pre-authorised
automation rule — see [AUTOMATIONS.md](AUTOMATIONS.md).

## "KAIDO is stopped"

The emergency stop is engaged.

```bash
node dist/cli.js resume
```

## Tests pass locally but fail on CI

Run the exact CI sequence:

```bash
npm ci && npm run typecheck && npm test && npm run build
```

The suite is hermetic — it uses the mock provider and no on-disk data directory — so
a CI-only failure almost always means an environment difference (Node version) rather
than test ordering or state leakage.

## Memory grew and I want it gone

```ts
kaido.memory.clearAgent(agentId)   // one agent
kaido.memory.remove(recordId)      // one record
```

Sensitive records can only be written with an explicit `user_stated` basis, so an
agent cannot quietly accumulate private data.

## Where the data lives

Agents, memory and the audit log persist under `KAIDO_DATA_DIR`. Delete that
directory to start clean. The audit log is append-only JSONL — back it up before
clearing if you may need the trail.
