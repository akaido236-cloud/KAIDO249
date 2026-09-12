import { makeId, nowIso } from '../core/ids.js';
import {
  ChildAgent,
  ConfirmationPolicy,
  DEFAULT_CONFIRMATION_POLICY,
  MemoryScope,
  Permission,
  RiskLevel,
} from '../core/types.js';

/** Everything needed to create an agent. A template is just a partial of this. */
export type AgentSpec = {
  name: string;
  description: string;
  icon?: string;
  systemPrompt: string;
  model?: string;
  tools: string[];
  integrations?: string[];
  permissions: Permission[];
  memoryScope?: MemoryScope;
  readableNamespaces?: string[];
  confirmationPolicy?: ConfirmationPolicy;
  parentAgentId?: string;
  enabled?: boolean;
};

// Bump this when a provider retires a model. Override per-shell with
// KAIDO_DEFAULT_MODEL, or per-agent with spec.model.
export const DEFAULT_MODEL = process.env.KAIDO_DEFAULT_MODEL ?? 'gemini-3.6-flash';

/**
 * The AgentFactory turns a spec into a fully-formed ChildAgent. Agents are
 * pure configuration — creating one never duplicates application code, and
 * a new agent never inherits the Master Agent's permissions.
 */
export class AgentFactory {
  private readonly now = () => nowIso();

  create(spec: AgentSpec): ChildAgent {
    this.assertSpec(spec);
    const id = makeId('agt');
    const ts = this.now();
    return {
      id,
      name: spec.name,
      description: spec.description,
      icon: spec.icon,
      systemPrompt: spec.systemPrompt,
      model: spec.model ?? DEFAULT_MODEL,
      enabled: spec.enabled ?? true,
      tools: [...new Set(spec.tools)],
      integrations: [...new Set(spec.integrations ?? [])],
      permissions: [...new Set(spec.permissions)],
      memoryScope: spec.memoryScope ?? 'PRIVATE',
      readableNamespaces: spec.readableNamespaces ?? [],
      automationIds: [],
      triggerIds: [],
      confirmationPolicy: spec.confirmationPolicy ?? DEFAULT_CONFIRMATION_POLICY,
      parentAgentId: spec.parentAgentId,
      childAgentIds: [],
      version: 1,
      createdAt: ts,
      updatedAt: ts,
    };
  }

  /**
   * Clone an agent: copies config, prompt, tools and permissions, but mints a
   * new id and leaves memory, logs and automations unshared. Secrets are
   * never copied — there are none stored on an agent to begin with.
   */
  clone(source: ChildAgent, overrides: Partial<AgentSpec> & { name?: string } = {}): ChildAgent {
    const ts = this.now();
    return {
      ...source,
      id: makeId('agt'),
      name: overrides.name ?? `${source.name} (copy)`,
      description: overrides.description ?? source.description,
      systemPrompt: overrides.systemPrompt ?? source.systemPrompt,
      tools: [...source.tools],
      integrations: [...source.integrations],
      permissions: [...source.permissions],
      memoryScope: source.memoryScope,
      readableNamespaces: [...source.readableNamespaces],
      automationIds: [],
      triggerIds: [],
      childAgentIds: [],
      parentAgentId: overrides.parentAgentId ?? source.parentAgentId,
      version: 1,
      createdAt: ts,
      updatedAt: ts,
    };
  }

  /**
   * Apply a change to an agent as a NEW version. Any change to prompt, tools,
   * permissions or policy bumps the version so history is preserved.
   */
  revise(current: ChildAgent, patch: Partial<AgentSpec>): ChildAgent {
    const meaningful =
      patch.systemPrompt !== undefined ||
      patch.tools !== undefined ||
      patch.permissions !== undefined ||
      patch.confirmationPolicy !== undefined ||
      patch.model !== undefined ||
      patch.memoryScope !== undefined;
    return {
      ...current,
      name: patch.name ?? current.name,
      description: patch.description ?? current.description,
      systemPrompt: patch.systemPrompt ?? current.systemPrompt,
      model: patch.model ?? current.model,
      tools: patch.tools ? [...new Set(patch.tools)] : current.tools,
      integrations: patch.integrations ? [...new Set(patch.integrations)] : current.integrations,
      permissions: patch.permissions ? [...new Set(patch.permissions)] : current.permissions,
      memoryScope: patch.memoryScope ?? current.memoryScope,
      readableNamespaces: patch.readableNamespaces ?? current.readableNamespaces,
      confirmationPolicy: patch.confirmationPolicy ?? current.confirmationPolicy,
      enabled: patch.enabled ?? current.enabled,
      version: meaningful ? current.version + 1 : current.version,
      updatedAt: nowIso(),
    };
  }

  private assertSpec(spec: AgentSpec): void {
    if (!spec.name || spec.name.trim().length < 2) {
      throw new Error('Agent name must be at least 2 characters.');
    }
    if (!spec.systemPrompt || spec.systemPrompt.trim().length < 10) {
      throw new Error('Agent systemPrompt is required and must be meaningful.');
    }
    if (!Array.isArray(spec.tools)) {
      throw new Error('Agent tools must be an array (may be empty).');
    }
    if (!Array.isArray(spec.permissions)) {
      throw new Error('Agent permissions must be an array (may be empty).');
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Guardrails applied to a risky tool by default.
// ─────────────────────────────────────────────────────────────────────────────

export const WRITE_CONFIRM_POLICY: ConfirmationPolicy = {
  requireConfirmationFor: [RiskLevel.HIGH, RiskLevel.CRITICAL],
  forbiddenLevels: [],
  allowAutomationOverride: false,
};

export const CONSERVATIVE_POLICY: ConfirmationPolicy = {
  requireConfirmationFor: [RiskLevel.MEDIUM, RiskLevel.HIGH, RiskLevel.CRITICAL],
  forbiddenLevels: [],
  allowAutomationOverride: false,
};

export const READONLY_POLICY: ConfirmationPolicy = {
  requireConfirmationFor: [RiskLevel.HIGH, RiskLevel.CRITICAL],
  forbiddenLevels: [
    RiskLevel.HIGH,
    RiskLevel.CRITICAL,
  ],
  allowAutomationOverride: false,
};
