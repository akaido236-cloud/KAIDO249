# Tools

The Tool Registry is the single source of truth for what KAIDO can do. Tools are
registered centrally; an agent receives only the subset assigned to it, and only
after the runtime verifies its permissions.

## Tool shape

```ts
type AgentTool = {
  id: string
  name: string
  description: string
  category: ToolCategory
  permissions: Permission[]      // the runtime requires ALL of these
  riskLevel: RiskLevel           // LOW | MEDIUM | HIGH | CRITICAL
  requiresConfirmation: boolean
  inputSchema: ToolInputSchema
  sideEffect: boolean            // does it mutate state outside KAIDO?
  isAvailable?: () => boolean    // false when credentials/adapter are missing
  execute: (input, ctx) => Promise<ToolResult>
}
```

## Built-in tools (21)

### Email — `gmail.*`
| id | risk | permissions |
|---|---|---|
| `gmail.search` | LOW | READ_EMAIL |
| `gmail.read` | LOW | READ_EMAIL |
| `gmail.draft` | MEDIUM | DRAFT_EMAIL |
| `gmail.send` | HIGH | SEND_EMAIL |

### Drive — `drive.*`
| id | risk | permissions |
|---|---|---|
| `drive.search` | LOW | READ_DRIVE |
| `drive.create` | MEDIUM | WRITE_DRIVE |
| `drive.delete` | HIGH | DELETE_DRIVE |

### GitHub — `github.*`
| id | risk | permissions |
|---|---|---|
| `github.repositories` | LOW | READ_GITHUB |
| `github.actions` | LOW | READ_GITHUB |
| `github.issues` | LOW | READ_GITHUB |
| `github.createIssue` | MEDIUM | WRITE_GITHUB |

### Termux — `termux.*`
| id | risk | permissions |
|---|---|---|
| `termux.execute` | HIGH | TERMUX_EXECUTION |

Every command is validated against an allowlist before execution — see TERMUX.md.

### Android — `android.*`
| id | risk | permissions |
|---|---|---|
| `android.notifications` | LOW | READ_NOTIFICATIONS |
| `android.contacts` | LOW | READ_CONTACTS |
| `android.camera` | MEDIUM | CAMERA |
| `android.files` | LOW | FILES_READ |

### Web — `web.*`
| id | risk | permissions |
|---|---|---|
| `web.search` | LOW | WEB_READ |
| `web.extract` | LOW | WEB_READ |

### Internal — always available
| id | risk | permissions |
|---|---|---|
| `memory.search` | LOW | — |
| `memory.write` | LOW | — |
| `audit.read` | LOW | — |

## Availability honesty

Tools that depend on an external system report their true state:

- `isAvailable()` returns false when credentials or an adapter are missing; the CLI
  shows `not configured` in the tool listing.
- Calling one anyway returns `{ ok: false, code: 'INTEGRATION_UNAVAILABLE' }` or
  `{ ok: false, code: 'ADAPTER_NOT_MOUNTED' }`.

**A tool never fabricates a result.** If KAIDO cannot reach Gmail, it says Gmail is
not configured — it does not invent an inbox summary.

## Adding a tool

```ts
const myTool: AgentTool = {
  id: 'myservice.doThing',
  name: 'Do the thing',
  description: 'One sentence a model can use to decide when to call this.',
  category: 'internal',
  permissions: [Permission.FILES_READ],
  riskLevel: RiskLevel.MEDIUM,
  requiresConfirmation: false,
  sideEffect: true,
  inputSchema: {
    type: 'object',
    properties: { target: { type: 'string', description: 'What to act on' } },
    required: ['target'],
  },
  execute: async (input, ctx) => {
    const { target } = input as { target: string };
    return { ok: true, data: {}, summary: `Did the thing to ${target}.` };
  },
};
```

Register it via `registry.register(myTool)` (or add it to `BUILTIN_TOOLS`), then list
its id in an agent's `tools` and grant the permissions it declares.
