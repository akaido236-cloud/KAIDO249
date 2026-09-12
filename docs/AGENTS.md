# Agents

## The model

Every agent — Master or child — is a `ChildAgent` record:

```ts
type ChildAgent = {
  id: string
  name: string
  description: string
  icon?: string
  systemPrompt: string
  model: string
  enabled: boolean
  tools: string[]
  integrations: string[]
  permissions: AgentPermission[]
  memoryScope: 'PRIVATE' | 'SHARED' | 'SELECTIVE'
  readableNamespaces: string[]
  automationIds: string[]
  triggerIds: string[]
  confirmationPolicy: ConfirmationPolicy
  parentAgentId?: string
  childAgentIds: string[]
  version: number
  createdAt: string
  updatedAt: string
}
```

Agents are **configuration**. Creating one never duplicates application code — it
writes a record and applies its permissions.

## Master vs child

The **Master Agent (KAIDO)** orchestrates. It holds **no tools and no permissions** —
it can only plan and delegate. That is structural, not stylistic: it means the
orchestrator has nothing to execute with, so every effect necessarily goes through a
child agent and the runtime gate.

**Child agents** are specialised workers. Each has its own prompt, tools, permission
set, memory scope and confirmation policy.

## Hierarchy

Hierarchy is supported and optional:

```
KAIDO
├── KAIDO CODER
│   ├── GitHub Worker
│   └── Testing Worker
├── KAIDO RESEARCHER
└── KAIDO PUBLISHER
```

`parentAgentId` links a child to a parent, and the parent's `childAgentIds` tracks
its children. Deleting a parent orphans rather than deletes its children.

## Isolation guarantees

| Property | Guarantee |
|---|---|
| Tools | An agent may only invoke tools in its own `tools` array, checked at the runtime. |
| Permissions | An agent holds its own set; it never inherits the Master's. |
| Memory | PRIVATE by default. SHARED adds the shared namespace. SELECTIVE adds only the namespaces explicitly listed. |
| Confirmations | Each agent has its own policy; a stricter agent cannot be loosened by a looser one. |
| Model | Per-agent, so a cheap model can run a low-stakes agent and a strong one the coder. |

## Built-in templates

| id | label | memory | notable policy |
|---|---|---|---|
| `kaido-coder` | KAIDO CODER | PRIVATE | confirmation for HIGH/CRITICAL |
| `kaido-researcher` | KAIDO RESEARCHER | SHARED | read-only (HIGH+ forbidden) |
| `kaido-devops` | KAIDO DEVOPS | PRIVATE | confirmation for HIGH/CRITICAL |
| `kaido-email` | KAIDO EMAIL | PRIVATE | confirmation for HIGH/CRITICAL |
| `kaido-publisher` | KAIDO PUBLISHER | SHARED | confirmation for MEDIUM+ |
| `kaido-whatsapp` | KAIDO WHATSAPP | PRIVATE | confirmation for MEDIUM+; hard legal limits in prompt |
| `kaido-security` | KAIDO SECURITY | PRIVATE | read-only |
| `kaido-file` | KAIDO FILE | PRIVATE | confirmation for MEDIUM+ |

Instantiate one from the CLI:

```bash
node dist/cli.js add-template kaido-coder
node dist/cli.js add-all-templates
```

## Agent chat

Each agent is addressed by name. The Master Agent routes automatically, or you can
direct a task at one agent:

```bash
node dist/cli.js ask "why did my deployment fail"          # Master routes → KAIDO DEVOPS
node dist/cli.js ask "check my latest build"               # Master routes → KAIDO CODER
```

Programmatically:

```ts
await kaido.ask(goal)                    // plan → delegate → outcome
await kaido.askAgent('KAIDO CODER', obj) // one agent, no planning
```

## Activity & audit

Every action is traceable:

```bash
node dist/cli.js activity               # last 40 entries, all agents
node dist/cli.js activity <agentId>     # one agent
```

Each entry carries timestamp, event type, agent, task, tool, permission decision,
risk and result. Agent actions are transparent by construction — the model cannot
act without leaving a record.

## Memory scopes

```
KAIDO CODER     PRIVATE    → its own records only
KAIDO RESEARCHER SHARED     → its records + the shared namespace
KAIDO PUBLISHER  SELECTIVE  → its records + only whitelisted shared namespaces
```

Shared knowledge is written explicitly:

```ts
kaido.memory.writeShared({
  namespace: 'OIU', kind: 'PROJECT', key: 'stack',
  value: 'React + TypeScript + Cloudflare', basis: 'user_stated',
})
```

And a SELECTIVE agent reads it only if `'OIU'` is in its `readableNamespaces`.
