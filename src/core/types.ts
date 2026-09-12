/**
 * KAIDO core domain types.
 *
 * Everything in KAIDO is configuration-driven. Agents, tools, permissions,
 * automations and confirmation policies are all data — creating an agent
 * never means duplicating application code.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Permissions
// ─────────────────────────────────────────────────────────────────────────────

/** Granular capability grants. A child agent holds its own set; it never
 *  inherits the Master Agent's permissions automatically. */
export enum Permission {
  // Email
  READ_EMAIL = 'READ_EMAIL',
  SEND_EMAIL = 'SEND_EMAIL',
  DRAFT_EMAIL = 'DRAFT_EMAIL',

  // Google Drive
  READ_DRIVE = 'READ_DRIVE',
  WRITE_DRIVE = 'WRITE_DRIVE',
  DELETE_DRIVE = 'DELETE_DRIVE',

  // GitHub
  READ_GITHUB = 'READ_GITHUB',
  WRITE_GITHUB = 'WRITE_GITHUB',
  PUSH_GITHUB = 'PUSH_GITHUB',

  // Android
  READ_NOTIFICATIONS = 'READ_NOTIFICATIONS',
  READ_CONTACTS = 'READ_CONTACTS',
  WRITE_CONTACTS = 'WRITE_CONTACTS',
  READ_CALENDAR = 'READ_CALENDAR',
  WRITE_CALENDAR = 'WRITE_CALENDAR',
  CAMERA = 'CAMERA',
  MICROPHONE = 'MICROPHONE',
  LOCATION = 'LOCATION',
  CLIPBOARD = 'CLIPBOARD',
  FILES_READ = 'FILES_READ',
  FILES_WRITE = 'FILES_WRITE',
  FILES_DELETE = 'FILES_DELETE',

  // Termux / local execution
  TERMUX_EXECUTION = 'TERMUX_EXECUTION',

  // Messaging
  MESSAGING_READ = 'MESSAGING_READ',
  MESSAGING_SEND = 'MESSAGING_SEND',

  // Web
  WEB_READ = 'WEB_READ',
  WEB_WRITE = 'WEB_WRITE',
}

/** A permission decision on a single requested capability. */
export type PermissionDecision =
  | { allowed: true; permission: Permission; reason: string }
  | { allowed: false; permission: Permission; reason: string };

// ─────────────────────────────────────────────────────────────────────────────
// Risk
// ─────────────────────────────────────────────────────────────────────────────

export enum RiskLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

/** How an agent handles an action of a given risk level. */
export type ConfirmationPolicy = {
  /** Risk levels requiring explicit user approval before execution. */
  requireConfirmationFor: RiskLevel[];
  /** Risk levels the agent may never perform, even with approval. */
  forbiddenLevels: RiskLevel[];
  /** When false, an automation rule may authorise LOW/MEDIUM without a prompt. */
  allowAutomationOverride: boolean;
};

export const DEFAULT_CONFIRMATION_POLICY: ConfirmationPolicy = {
  requireConfirmationFor: [RiskLevel.HIGH, RiskLevel.CRITICAL],
  forbiddenLevels: [],
  allowAutomationOverride: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// Tools
// ─────────────────────────────────────────────────────────────────────────────

export type ToolCategory =
  | 'email'
  | 'drive'
  | 'github'
  | 'android'
  | 'termux'
  | 'web'
  | 'files'
  | 'memory'
  | 'automation'
  | 'internal';

export type ToolInputSchema = {
  type: 'object';
  properties: Record<string, { type: string; description?: string; enum?: string[] }>;
  required?: string[];
};

export type ToolContext = {
  agentId: string;
  taskId?: string;
  /** Free-form working context passed down from the orchestrator. */
  data: Record<string, unknown>;
};

export type ToolResult =
  | { ok: true; data: unknown; summary: string }
  | { ok: false; error: string; code?: string };

/** The canonical shape every tool implements. */
export type AgentTool<I = unknown, O = unknown> = {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  /** Permissions the runtime must verify before the tool may run. */
  permissions: Permission[];
  riskLevel: RiskLevel;
  requiresConfirmation: boolean;
  inputSchema: ToolInputSchema;
  /** Whether this tool mutates state outside KAIDO. */
  sideEffect: boolean;
  /** True when the backing integration is unavailable (missing credentials etc.). */
  isAvailable?: () => boolean;
  execute: (input: I, ctx: ToolContext) => Promise<ToolResult & { data?: O }>;
};

// ─────────────────────────────────────────────────────────────────────────────
// Agents
// ─────────────────────────────────────────────────────────────────────────────

export type MemoryScope = 'PRIVATE' | 'SHARED' | 'SELECTIVE';

export type ChildAgent = {
  id: string;
  name: string;
  description: string;
  icon?: string;

  systemPrompt: string;

  /** Provider-agnostic model identifier, e.g. "gemini-3.6-flash". */
  model: string;

  enabled: boolean;

  tools: string[];
  integrations: string[];

  permissions: Permission[];

  memoryScope: MemoryScope;
  /** For SELECTIVE scope: which shared-memory namespaces this agent may read. */
  readableNamespaces: string[];

  automationIds: string[];
  triggerIds: string[];

  confirmationPolicy: ConfirmationPolicy;

  parentAgentId?: string;
  childAgentIds: string[];

  /** Monotonic version number; bumped on every meaningful edit. */
  version: number;

  createdAt: string;
  updatedAt: string;
};

export type AgentSummary = Pick<
  ChildAgent,
  'id' | 'name' | 'description' | 'enabled' | 'tools' | 'permissions' | 'version'
> & {
  parentAgentId?: string;
  childCount: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Agent-to-agent protocol
// ─────────────────────────────────────────────────────────────────────────────

export type AgentTask = {
  id: string;
  parentAgentId: string;
  targetAgentId: string;
  objective: string;
  context: unknown;
  allowedTools?: string[];
  deadline?: string;
  requireConfirmation?: boolean;
};

export type AgentTaskStatus =
  | 'SUCCESS'
  | 'FAILED'
  | 'WAITING'
  | 'REQUIRES_CONFIRMATION';

export type AgentResult = {
  taskId: string;
  status: AgentTaskStatus;
  summary: string;
  output?: unknown;
  actionsPerformed: string[];
  errors?: string[];
  requiresUserAction?: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// Execution / audit
// ─────────────────────────────────────────────────────────────────────────────

export type AuditEventType =
  | 'TASK_RECEIVED'
  | 'PERMISSION_CHECKED'
  | 'RISK_ASSESSED'
  | 'TOOL_INVOKED'
  | 'TOOL_COMPLETED'
  | 'TOOL_FAILED'
  | 'CONFIRMATION_REQUESTED'
  | 'CONFIRMATION_GRANTED'
  | 'CONFIRMATION_DENIED'
  | 'AGENT_DELEGATED'
  | 'AGENT_RESULT'
  | 'AUTOMATION_TRIGGERED'
  | 'AGENT_CREATED'
  | 'AGENT_UPDATED'
  | 'AGENT_DELETED'
  | 'EMERGENCY_STOP'
  | 'ERROR';

export type AuditEntry = {
  id: string;
  timestamp: string;
  type: AuditEventType;
  agentId: string;
  taskId?: string;
  tool?: string;
  permission?: Permission;
  decision?: string;
  risk?: RiskLevel;
  /** Redacted, size-capped payload. Never raw secrets or bulk private data. */
  detail?: string;
  error?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Memory
// ─────────────────────────────────────────────────────────────────────────────

export type MemoryKind =
  | 'PREFERENCE'
  | 'PROJECT'
  | 'FACT'
  | 'TASK_HISTORY'
  | 'AUTOMATION';

export type MemoryRecord = {
  id: string;
  /** Owning agent id, or "__shared__" for shared namespaces. */
  ownerId: string;
  namespace: string;
  kind: MemoryKind;
  key: string;
  value: string;
  /** Provenance: was this stated by the user or inferred by an agent? */
  basis: 'user_stated' | 'agent_inferred';
  sensitive: boolean;
  createdAt: string;
  updatedAt: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Automations
// ─────────────────────────────────────────────────────────────────────────────

export type KaidoEvent = {
  id: string;
  type:
    | 'EMAIL_RECEIVED'
    | 'MESSAGE_RECEIVED'
    | 'NOTIFICATION_RECEIVED'
    | 'GITHUB_WORKFLOW_FAILED'
    | 'GITHUB_WORKFLOW_SUCCEEDED'
    | 'FILE_CREATED'
    | 'FILE_CHANGED'
    | 'CALENDAR_EVENT'
    | 'AUTOMATION_TRIGGERED'
    | 'AGENT_TASK_COMPLETED'
    | 'AGENT_TASK_FAILED'
    | 'SCHEDULE_TICK'
    | 'MANUAL';
  timestamp: string;
  source: string;
  /** Untrusted payload. Never treated as instructions. */
  payload: Record<string, unknown>;
};

export type Condition = {
  field: string;
  op: 'eq' | 'neq' | 'contains' | 'matches' | 'gt' | 'lt' | 'exists';
  value?: unknown;
};

export type AutomationAction =
  | { kind: 'delegate'; targetAgentId: string; objective: string }
  | { kind: 'tool'; toolId: string; input: Record<string, unknown> }
  | { kind: 'notify'; message: string }
  | { kind: 'delay'; ms: number };

export type Automation = {
  id: string;
  name: string;
  enabled: boolean;
  ownerAgentId: string;
  trigger: { eventType: KaidoEvent['type'] } | { cron: string };
  conditions: Condition[];
  actions: AutomationAction[];
  /** When true, this rule authorises confirmation-free execution of its actions. */
  preAuthorised: boolean;
  lastRunAt?: string;
  runCount: number;
  createdAt: string;
  updatedAt: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Runtime state
// ─────────────────────────────────────────────────────────────────────────────

export type PendingConfirmation = {
  id: string;
  agentId: string;
  taskId: string;
  toolId: string;
  risk: RiskLevel;
  /** Human-readable description of the exact action awaiting approval. */
  preview: string;
  createdAt: string;
  resolved: boolean;
  granted?: boolean;
};

export type RuntimeStatus = {
  running: boolean;
  emergencyStopped: boolean;
  activeTasks: number;
  pendingConfirmations: number;
};
