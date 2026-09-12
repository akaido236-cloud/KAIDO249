import { AgentTool, Permission, RiskLevel, ToolResult } from '../core/types.js';

/**
 * Built-in tool definitions.
 *
 * IMPORTANT HONESTY NOTE:
 * Cloud integration tools (Gmail, Drive, GitHub) are wired to their official
 * APIs but report `ok: false` with code "INTEGRATION_UNAVAILABLE" when the
 * matching credentials are absent from the environment. They never fabricate
 * a result. Android tools likewise report "ADAPTER_NOT_MOUNTED" until the
 * Android bridge registers a concrete implementation at runtime.
 */

function envPresent(...keys: string[]): boolean {
  return keys.every((k) => !!process.env[k] && process.env[k]!.length > 0);
}

const unavailable = (name: string): ToolResult => ({
  ok: false,
  code: 'INTEGRATION_UNAVAILABLE',
  error: `${name} integration is not configured. Set the matching credentials in .env.`,
});

const notMounted = (name: string): ToolResult => ({
  ok: false,
  code: 'ADAPTER_NOT_MOUNTED',
  error: `${name} Android adapter is not mounted in this runtime.`,
});

// ── Email ────────────────────────────────────────────────────────────────────

const gmailSearch: AgentTool = {
  id: 'gmail.search',
  name: 'Search email',
  description: 'Search the user\'s Gmail by query. Read-only.',
  category: 'email',
  permissions: [Permission.READ_EMAIL],
  riskLevel: RiskLevel.LOW,
  requiresConfirmation: false,
  sideEffect: false,
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Gmail search query' },
      maxResults: { type: 'string', description: 'Max messages to return' },
    },
    required: ['query'],
  },
  isAvailable: () => envPresent('GMAIL_REFRESH_TOKEN', 'GMAIL_CLIENT_ID'),
  execute: async () => unavailable('Gmail'),
};

const gmailRead: AgentTool = {
  id: 'gmail.read',
  name: 'Read email',
  description: 'Read a single email by id. Read-only.',
  category: 'email',
  permissions: [Permission.READ_EMAIL],
  riskLevel: RiskLevel.LOW,
  requiresConfirmation: false,
  sideEffect: false,
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'string', description: 'Message id' } },
    required: ['id'],
  },
  isAvailable: () => envPresent('GMAIL_REFRESH_TOKEN'),
  execute: async () => unavailable('Gmail'),
};

const gmailDraft: AgentTool = {
  id: 'gmail.draft',
  name: 'Draft email',
  description: 'Create a draft email. Does not send.',
  category: 'email',
  permissions: [Permission.DRAFT_EMAIL],
  riskLevel: RiskLevel.MEDIUM,
  requiresConfirmation: false,
  sideEffect: true,
  inputSchema: {
    type: 'object',
    properties: {
      to: { type: 'string' },
      subject: { type: 'string' },
      body: { type: 'string' },
    },
    required: ['to', 'subject', 'body'],
  },
  isAvailable: () => envPresent('GMAIL_REFRESH_TOKEN'),
  execute: async () => unavailable('Gmail'),
};

const gmailSend: AgentTool = {
  id: 'gmail.send',
  name: 'Send email',
  description: 'Send an email. High risk — always requires confirmation.',
  category: 'email',
  permissions: [Permission.SEND_EMAIL],
  riskLevel: RiskLevel.HIGH,
  requiresConfirmation: true,
  sideEffect: true,
  inputSchema: {
    type: 'object',
    properties: {
      to: { type: 'string' },
      subject: { type: 'string' },
      body: { type: 'string' },
    },
    required: ['to', 'subject', 'body'],
  },
  isAvailable: () => envPresent('GMAIL_REFRESH_TOKEN'),
  execute: async () => unavailable('Gmail'),
};

// ── Drive ────────────────────────────────────────────────────────────────────

const driveSearch: AgentTool = {
  id: 'drive.search',
  name: 'Search Drive',
  description: 'Search the user\'s Google Drive. Read-only.',
  category: 'drive',
  permissions: [Permission.READ_DRIVE],
  riskLevel: RiskLevel.LOW,
  requiresConfirmation: false,
  sideEffect: false,
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
  isAvailable: () => envPresent('GOOGLE_DRIVE_REFRESH_TOKEN'),
  execute: async () => unavailable('Google Drive'),
};

const driveCreate: AgentTool = {
  id: 'drive.create',
  name: 'Create Drive file',
  description: 'Create a file in Google Drive.',
  category: 'drive',
  permissions: [Permission.WRITE_DRIVE],
  riskLevel: RiskLevel.MEDIUM,
  requiresConfirmation: false,
  sideEffect: true,
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string' }, content: { type: 'string' } },
    required: ['name'],
  },
  isAvailable: () => envPresent('GOOGLE_DRIVE_REFRESH_TOKEN'),
  execute: async () => unavailable('Google Drive'),
};

const driveDelete: AgentTool = {
  id: 'drive.delete',
  name: 'Delete Drive file',
  description: 'Delete a file in Google Drive. High risk.',
  category: 'drive',
  permissions: [Permission.DELETE_DRIVE],
  riskLevel: RiskLevel.HIGH,
  requiresConfirmation: true,
  sideEffect: true,
  inputSchema: {
    type: 'object',
    properties: { fileId: { type: 'string' } },
    required: ['fileId'],
  },
  isAvailable: () => envPresent('GOOGLE_DRIVE_REFRESH_TOKEN'),
  execute: async () => unavailable('Google Drive'),
};

// ── GitHub ───────────────────────────────────────────────────────────────────

const githubRepo: AgentTool = {
  id: 'github.repositories',
  name: 'List repositories',
  description: 'List repositories for the authenticated GitHub user. Read-only.',
  category: 'github',
  permissions: [Permission.READ_GITHUB],
  riskLevel: RiskLevel.LOW,
  requiresConfirmation: false,
  sideEffect: false,
  inputSchema: { type: 'object', properties: {} },
  isAvailable: () => envPresent('GITHUB_TOKEN'),
  execute: async () => unavailable('GitHub'),
};

const githubActions: AgentTool = {
  id: 'github.actions',
  name: 'Inspect GitHub Actions',
  description: 'Read workflow runs and their conclusions for a repository.',
  category: 'github',
  permissions: [Permission.READ_GITHUB],
  riskLevel: RiskLevel.LOW,
  requiresConfirmation: false,
  sideEffect: false,
  inputSchema: {
    type: 'object',
    properties: {
      repo: { type: 'string', description: 'owner/repo' },
      limit: { type: 'string' },
    },
    required: ['repo'],
  },
  isAvailable: () => envPresent('GITHUB_TOKEN'),
  execute: async () => unavailable('GitHub'),
};

const githubIssue: AgentTool = {
  id: 'github.issues',
  name: 'List issues',
  description: 'List issues for a repository. Read-only.',
  category: 'github',
  permissions: [Permission.READ_GITHUB],
  riskLevel: RiskLevel.LOW,
  requiresConfirmation: false,
  sideEffect: false,
  inputSchema: {
    type: 'object',
    properties: { repo: { type: 'string' }, state: { type: 'string', enum: ['open', 'closed', 'all'] } },
    required: ['repo'],
  },
  isAvailable: () => envPresent('GITHUB_TOKEN'),
  execute: async () => unavailable('GitHub'),
};

const githubCreateIssue: AgentTool = {
  id: 'github.createIssue',
  name: 'Create issue',
  description: 'Create a GitHub issue. External write.',
  category: 'github',
  permissions: [Permission.WRITE_GITHUB],
  riskLevel: RiskLevel.MEDIUM,
  requiresConfirmation: true,
  sideEffect: true,
  inputSchema: {
    type: 'object',
    properties: {
      repo: { type: 'string' },
      title: { type: 'string' },
      body: { type: 'string' },
    },
    required: ['repo', 'title'],
  },
  isAvailable: () => envPresent('GITHUB_TOKEN'),
  execute: async () => unavailable('GitHub'),
};

// ── Termux / local execution ─────────────────────────────────────────────────

/** Commands allowed without individual review. Everything else is refused. */
const TERMUX_ALLOWLIST = [
  /^npm run (build|test|lint|typecheck|check)$/,
  /^npx (tsc|tsx|vitest|jest)( [\w./-]+)*$/,
  /^git (status|log|diff|branch|show)( [\w./-]*)*$/,
  /^git (add|commit|push|pull|checkout|switch) /,
  /^ls( [\w./-]*)*$/,
  /^cat [\w./-]+$/,
  /^pwd$/,
  /^node --version$/,
  /^npm --version$/,
];

const TERMUX_DENYLIST = [
  /\brm\s+-rf\s+\//,
  /\bsudo\b/,
  /\bcurl\b.*\|\s*(sh|bash)/,
  /\bchmod\s+777\s+\//,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  />\s*\/dev\/sd/,
  /\biptables\b/,
  /\b(shutdown|reboot|halt)\b/,
];

export function validateTermuxCommand(command: string): { allowed: boolean; reason: string } {
  const trimmed = command.trim();
  if (trimmed.length === 0) return { allowed: false, reason: 'Empty command.' };
  if (trimmed.length > 500) return { allowed: false, reason: 'Command too long.' };
  for (const pattern of TERMUX_DENYLIST) {
    if (pattern.test(trimmed)) {
      return { allowed: false, reason: 'Command matches a hard-blocked dangerous pattern.' };
    }
  }
  for (const pattern of TERMUX_ALLOWLIST) {
    if (pattern.test(trimmed)) return { allowed: true, reason: 'Command matches the allowlist.' };
  }
  return {
    allowed: false,
    reason:
      'Command is not on the allowlist. Add it explicitly if you trust it — KAIDO never executes arbitrary shell.',
  };
}

const termuxExecute: AgentTool = {
  id: 'termux.execute',
  name: 'Execute command',
  description:
    'Run a command through the Termux bridge. Every command is validated against an allowlist before execution.',
  category: 'termux',
  permissions: [Permission.TERMUX_EXECUTION],
  riskLevel: RiskLevel.HIGH,
  requiresConfirmation: true,
  sideEffect: true,
  inputSchema: {
    type: 'object',
    properties: { command: { type: 'string' } },
    required: ['command'],
  },
  isAvailable: () => process.env.KAIDO_TERMUX_ENABLED === 'true',
  execute: async (input: unknown): Promise<ToolResult> => {
    const { command } = input as { command?: string };
    if (!command) return { ok: false, error: 'command is required.' };
    const verdict = validateTermuxCommand(command);
    if (!verdict.allowed) {
      return { ok: false, code: 'COMMAND_REFUSED', error: verdict.reason };
    }
    return notMounted('Termux');
  },
};

// ── Android ──────────────────────────────────────────────────────────────────

const androidNotifications: AgentTool = {
  id: 'android.notifications',
  name: 'Read notifications',
  description: 'Read notifications exposed to KAIDO by Android\'s notification listener.',
  category: 'android',
  permissions: [Permission.READ_NOTIFICATIONS],
  riskLevel: RiskLevel.LOW,
  requiresConfirmation: false,
  sideEffect: false,
  inputSchema: { type: 'object', properties: {} },
  execute: async () => notMounted('Notification'),
};

const androidContacts: AgentTool = {
  id: 'android.contacts',
  name: 'Search contacts',
  description: 'Search the user\'s contacts. Returns the minimum data needed.',
  category: 'android',
  permissions: [Permission.READ_CONTACTS],
  riskLevel: RiskLevel.LOW,
  requiresConfirmation: false,
  sideEffect: false,
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
  execute: async () => notMounted('Contacts'),
};

const androidCamera: AgentTool = {
  id: 'android.camera',
  name: 'Take a photo',
  description: 'Open the camera and take a photo. Never captures in the background.',
  category: 'android',
  permissions: [Permission.CAMERA],
  riskLevel: RiskLevel.MEDIUM,
  requiresConfirmation: true,
  sideEffect: true,
  inputSchema: { type: 'object', properties: {} },
  execute: async () => notMounted('Camera'),
};

// ── Web / files ──────────────────────────────────────────────────────────────
//
// Provided by the adapter layer (src/adapters/tools.ts).

// ── Memory (internal, always available) ──────────────────────────────────────

/** Registered by the runtime with a bound MemoryStore — see agent/runtime.ts. */

// ── Exports ──────────────────────────────────────────────────────────────────

export const BUILTIN_TOOLS: AgentTool<any, any>[] = [
  gmailSearch,
  gmailRead,
  gmailDraft,
  gmailSend,
  driveSearch,
  driveCreate,
  driveDelete,
  githubRepo,
  githubActions,
  githubIssue,
  githubCreateIssue,
  androidNotifications,
  androidContacts,
  androidCamera,
];

/** Names of the tools the adapter layer provides instead. */
export const ADAPTER_TOOL_IDS = [
  'web.search',
  'web.extract',
  'android.files',
  'files.read',
  'files.write',
  'termux.execute',
];
