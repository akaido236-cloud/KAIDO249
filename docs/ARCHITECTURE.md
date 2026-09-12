# Architecture

## Layers

```
┌──────────────────────────────────────────────────────────────────┐
│  Interface layer                                                 │
│  cli.ts  ·  (phase 4+) Android UI  ·  (phase 7+) workflow builder │
└──────────────────────────────────────────────────────────────────┘
                              │
┌──────────────────────────────────────────────────────────────────┐
│  Orchestration layer                                             │
│  MasterOrchestrator — plan · route · delegate · collect · report │
│  AgentCreator      — natural language → proposed config          │
└──────────────────────────────────────────────────────────────────┘
                              │
┌──────────────────────────────────────────────────────────────────┐
│  Agent layer                                                     │
│  AgentRegistry (persistent, hierarchical, versioned)             │
│  AgentFactory  (create · revise · clone)                         │
└──────────────────────────────────────────────────────────────────┘
                              │
┌──────────────────────────────────────────────────────────────────┐
│  THE GATE  —  AgentRuntime                                       │
│  stop-check → tool-exists → agent-assigned → permission →        │
│  risk → confirmation → execute → audit                           │
└──────────────────────────────────────────────────────────────────┘
        │                    │                    │
┌───────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  Tool layer   │  │  Security layer  │  │  Automation      │
│  ToolRegistry │  │  PermissionMgr   │  │  EventBus        │
│  21 built-ins │  │  RiskEngine      │  │  AutomationEngine│
│               │  │  AuditLog        │  │                  │
│               │  │  injection.ts    │  │                  │
└───────────────┘  └──────────────────┘  └──────────────────┘
        │                    │
┌───────────────┐  ┌──────────────────┐
│  MemoryStore  │  │  AIProvider      │
│  private/     │  │  Gemini          │
│  shared/      │  │  Mock            │
│  selective    │  │  (extensible)    │
└───────────────┘  └──────────────────┘
```

## Source map

```
src/
├── index.ts              Kaido — the assembled system (wiring + façade)
├── cli.ts                headless CLI
├── core/
│   ├── types.ts          every domain type (agents, tools, risk, audit, …)
│   └── ids.ts            id + timestamp helpers
├── security/
│   ├── permissions.ts    PermissionManager — the permission gate
│   ├── risk.ts           RiskEngine — escalation + policy evaluation
│   ├── audit.ts          AuditLog — append-only JSONL
│   └── injection.ts      prompt-injection defence + untrusted wrapping
├── tools/
│   ├── registry.ts       ToolRegistry
│   └── builtin.ts        the 21 built-in tools + Termux allowlist
├── ai/
│   ├── provider.ts       AIProvider interface
│   ├── gemini.ts         Google Gemini (default)
│   ├── mock.ts           deterministic provider (tests / offline)
│   └── index.ts          provider registry
├── memory/
│   └── store.ts          MemoryStore with scope isolation
├── agent/
│   ├── factory.ts        AgentFactory + default confirmation policies
│   ├── registry.ts       AgentRegistry (persist, version, clone, rollback)
│   ├── runtime.ts        AgentRuntime — THE execution gate
│   ├── orchestrator.ts   MasterOrchestrator
│   ├── creator.ts        natural-language agent creation
│   └── templates.ts      eight built-in agent templates
└── automation/
    └── engine.ts         EventBus + AutomationEngine
```

## The execution path, in detail

Every effect in KAIDO — without exception — flows through
`AgentRuntime.executeTool()`. The order is not incidental; each step closes a
specific hole.

```
1. emergency stop      if KAIDO is stopped, deny immediately
2. tool exists         unknown tool → deny (no dynamic tool creation)
3. agent was assigned  agent.tools must include the id → deny otherwise
4. permission check    agent must hold EVERY permission the tool declares
5. risk assessment     base risk escalated by side-effect / boundary / bulk / financial
6. policy evaluation   forbidden → deny · requires confirmation → gate · else proceed
7. confirmation gate   create a PendingConfirmation with a preview of the exact action
8. execution           tool.execute(input, ctx)
9. audit               invoke + completion/refusal recorded either way
```

The Master Agent holds **zero tools**. It can only delegate. A child agent can only
use the tools assigned to it *and* allowed by the caller. Both checks happen at the
runtime, so neither can be talked around by a prompt.

## Orchestration flow

```
user goal
   │
   ▼
MasterOrchestrator.plan(goal)          provider proposes 1–5 steps
   │  (falls back to deterministic single-step routing on any failure)
   ▼
DelegationPlan { steps: [{ agentName, objective }] }
   │
   ▼
executePlan()
   ├─ for each step:
   │     resolve agent (by name, else route())
   │     runtime.beginTask()
   │     delegate() → child runs → AgentResult
   │     runtime.endTask()
   ├─ REQUIRES_CONFIRMATION → stop the plan, surface the gate
   └─ collect results
   ▼
TaskOutcome { summary, results, actionsPerformed, requiresUserAction }
```

Plans stop at the first confirmation gate rather than running later steps against an
unapproved state. Parallel execution (phase 8) will only ever fan out **read-shaped**
work; conflicting destructive operations are never parallelised.

## Persistence

Agents, memory and the audit log persist as plain JSON / JSONL under
`KAIDO_DATA_DIR`. All three stores are optional — with `dataDir: null` (used by the
test suite) everything runs in memory, which is what makes the tests hermetic.

## Extending

- **New tool** — add an `AgentTool` to `src/tools/builtin.ts` and register it. The
  runtime picks it up with no other change.
- **New provider** — implement `AIProvider` and add a case in `src/ai/index.ts`.
- **New template** — add a spec to `TEMPLATES` in `src/agent/templates.ts`.
- **New event** — widen the `KaidoEvent['type']` union and publish from an adapter.

None of these require touching the runtime or the orchestrator.
