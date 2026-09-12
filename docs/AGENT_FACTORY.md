# Agent Factory

One of KAIDO's core features: creating new agents from inside KAIDO.

## Three ways to create an agent

### 1. From a template
```bash
node dist/cli.js add-template kaido-coder
node dist/cli.js add-all-templates
```

### 2. Natural language
```bash
node dist/cli.js create-agent "Create an agent called KAIDO OIU CODER. \
  It should help me program. Give it access to GitHub, Termux and project files. \
  It can inspect repositories, run tests, analyze errors and modify code. \
  It must ask before pushing changes."
```

KAIDO converts that into a structured configuration and shows a review block:

```
AGENT CONFIGURATION (proposed — not yet created)
  Name:          KAIDO OIU CODER
  Purpose:       Programming assistant for the OIU project.
  Tools:         github.repositories, termux.execute, android.files
  Permissions:   READ_GITHUB, TERMUX_EXECUTION, FILES_READ
  Confirmation:  HIGH, CRITICAL
  Memory:        PRIVATE

Nothing has been created. Review the configuration, then approve.
```

**Nothing is created until you approve.** And the proposal is constrained: tools and
permissions are filtered against the real catalogue, so an invented tool
(`evil.made.up.tool`) or an invented permission (`SUPERUSER_ALL`) is silently dropped.
Write and execute capabilities default to requiring confirmation.

Programmatically:

```ts
const proposal = await kaido.creator.propose('Create an agent called KAIDO OIU CODER...')
console.log(proposal.review)      // show the review block
const agent = kaido.creator.approve(proposal)   // only now is it created
```

### 3. Directly from a spec

```ts
kaido.registry.create({
  name: 'KAIDO OIU CODER',
  description: 'Programming assistant for the OIU project.',
  systemPrompt: 'You help program the OIU project. Ask before pushing.',
  tools: ['github.repositories', 'termux.execute'],
  permissions: [Permission.READ_GITHUB, Permission.TERMUX_EXECUTION],
  memoryScope: 'PRIVATE',
  confirmationPolicy: WRITE_CONFIRM_POLICY,
  parentAgentId: kaido.master.id,
})
```

## The guided flow (UI, phase 4)

The Android UI will present creation as a short sequence rather than a wall of
fields: **name → purpose → personality → tools → integrations → permissions →
memory → automations → confirmation policy → review → create** — with the
natural-language path always available as the fast route.

## Guardrails

- `assertSpec` rejects a name under 2 characters and a systemPrompt under 10.
- Duplicate tools and permissions are collapsed.
- A new agent always starts at **version 1**, enabled, memory PRIVATE, with the
  policy you pass (never an implicit unrestricted one).
- A child agent never inherits the parent's permissions.

## Versioning

Every meaningful change — prompt, tools, permissions, policy, model, memory scope —
appends a new version. Cosmetic changes (description text) do not.

```ts
kaido.registry.revise(id, { tools: [...] })   // → v2
kaido.registry.versions(id)                   // full history
kaido.registry.rollback(id, 1)                // restore v1 as a new version
```

Rollback never rewrites history — it creates a new version equal to the old one, so
the trail stays intact.

## Cloning

```ts
kaido.registry.clone(id, 'KAIDO OIU CODER')
```

A clone copies the prompt, tools, permissions and policy — and deliberately does
**not** copy:

- the id (a fresh one is minted),
- memory (the clone starts empty),
- logs (each agent audits separately),
- automations (the clone owns none),
- secrets (**there are none on an agent to copy**).

## Import / export

```ts
const bundle = kaido.registry.export(id)   // { agent, exportedAt }
```

The bundle contains configuration only. Credentials are never part of an agent
record, so there is nothing sensitive to strip — but review a bundle before sharing
it, since a system prompt may describe private workflows.
