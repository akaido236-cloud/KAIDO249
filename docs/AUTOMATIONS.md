# Automations

KAIDO is event-driven, not polling-driven. Adapters publish events; rules subscribe.

## The event bus

```
Event (from an adapter)
   ↓
EventBus.publish()
   ↓
AutomationEngine — match trigger, evaluate conditions
   ↓
actions: delegate · tool · notify · delay
   ↓
AgentRuntime (the same gate as everything else)
```

## Event types

`EMAIL_RECEIVED`, `MESSAGE_RECEIVED`, `NOTIFICATION_RECEIVED`,
`GITHUB_WORKFLOW_FAILED`, `GITHUB_WORKFLOW_SUCCEEDED`, `FILE_CREATED`,
`FILE_CHANGED`, `CALENDAR_EVENT`, `AUTOMATION_TRIGGERED`, `AGENT_TASK_COMPLETED`,
`AGENT_TASK_FAILED`, `SCHEDULE_TICK`, `MANUAL`.

Publishing is straightforward:

```ts
await kaido.bus.publish({
  type: 'NOTIFICATION_RECEIVED',
  source: 'android',
  payload: { app: 'com.whatsapp', text: 'URGENT: server down' },
})
```

## Rules: WHEN / IF / THEN

```ts
kaido.automations.register({
  name: 'urgent-message-watch',
  ownerAgentId: whatsappAgent.id,
  trigger: { eventType: 'NOTIFICATION_RECEIVED' },
  conditions: [{ field: 'payload.text', op: 'contains', value: 'urgent' }],
  actions: [{ kind: 'notify', message: 'Urgent message detected.' }],
  preAuthorised: false,
})
```

**Conditions** resolve against a flattened view of the event:
`type`, `source`, or any `payload.*` path. Operators: `eq`, `neq`, `contains`,
`matches` (regex), `gt`, `lt`, `exists`.

**Actions** are one of:
- `{ kind: 'delegate', targetAgentId, objective }` — hand the work to an agent.
- `{ kind: 'tool', toolId, input }` — call a tool directly.
- `{ kind: 'notify', message }` — record a notification.
- `{ kind: 'delay', ms }` — pause before the next action.

## The pre-authorisation rule

`preAuthorised: true` lets an automation run its actions without a confirmation
prompt — **but only if the owner agent's `confirmationPolicy.allowAutomationOverride`
is true**, and **never for a forbidden level**. Your standing decision to let an
automation act is honoured; a prompt-injected event cannot manufacture that authority.

## Worked examples

**GitHub failure → diagnose → notify**
```ts
kaido.automations.register({
  name: 'ci-failure-triage',
  ownerAgentId: devops.id,
  trigger: { eventType: 'GITHUB_WORKFLOW_FAILED' },
  conditions: [{ field: 'payload.repo', op: 'eq', value: 'me/app' }],
  actions: [
    { kind: 'delegate', targetAgentId: coder.id, objective: 'Analyse the failing CI run and propose a fix.' },
    { kind: 'notify', message: 'CI failure triaged — fix proposed, awaiting approval.' },
  ],
  preAuthorised: false,
})
```

**Evening digest**
```ts
kaido.automations.register({
  name: 'daily-digest',
  ownerAgentId: kaido.master.id,
  trigger: { cron: '0 20 * * *' },     // published as SCHEDULE_TICK by the scheduler
  conditions: [],
  actions: [{ kind: 'notify', message: 'Daily summary ready.' }],
  preAuthorised: false,
})
```

**Urgent WhatsApp notification**
```ts
kaido.automations.register({
  name: 'whatsapp-urgent',
  ownerAgentId: whatsapp.id,
  trigger: { eventType: 'NOTIFICATION_RECEIVED' },
  conditions: [
    { field: 'payload.app', op: 'contains', value: 'whatsapp' },
    { field: 'payload.text', op: 'matches', value: '(urgent|asap|now)' },
  ],
  actions: [{ kind: 'delegate', targetAgentId: whatsapp.id, objective: 'Classify this message and draft a reply.' }],
  preAuthorised: false,
})
```

## Control

```ts
kaido.automations.list()
kaido.automations.setEnabled(id, false)   // pause
kaido.automations.setEnabled(id, true)    // resume
kaido.automations.remove(id)              // delete
```

Every trigger is audited as `AUTOMATION_TRIGGERED` with the rule name and the event
type, so you can always answer "why did that run?".

## Not yet built

The cron scheduler (a tick publisher), the visual workflow builder, webhook ingress
and loop/parallel nodes are **phase 7–8**. The engine above is the substrate they
will drive; nothing here fabricates a trigger that does not exist yet.
