import { makeId, nowIso } from '../core/ids.js';
import {
  AgentTask,
  AgentResult,
  ChildAgent,
  Permission,
  PendingConfirmation,
  RiskLevel,
  RuntimeStatus,
  ToolResult,
} from '../core/types.js';
import { AuditLog } from '../security/audit.js';
import { PermissionManager } from '../security/permissions.js';
import { RiskEngine } from '../security/risk.js';
import { ToolRegistry } from '../tools/registry.js';
import { MemoryStore } from '../memory/store.js';

export type ExecutionOutcome =
  | { status: 'COMPLETED'; result: ToolResult; risk: RiskLevel; actionsPerformed: string[] }
  | { status: 'REQUIRES_CONFIRMATION'; confirmation: PendingConfirmation }
  | { status: 'DENIED'; reason: string; risk: RiskLevel }
  | { status: 'FORBIDDEN'; reason: string; risk: RiskLevel };

/**
 * The AgentRuntime is the only path by which anything executes.
 *
 * Every tool call passes through, in order:
 *   emergency-stop check → tool existence → permission check → risk
 *   assessment → confirmation gate → execution → audit.
 *
 * An LLM never executes anything directly; it can only request a tool call
 * here, and the runtime decides whether that request is allowed.
 */
export class AgentRuntime {
  private emergencyStopped = false;
  private activeTasks = new Set<string>();
  private confirmations = new Map<string, PendingConfirmation>();

  constructor(
    readonly registry: ToolRegistry,
    readonly permissions: PermissionManager,
    readonly risk: RiskEngine,
    readonly audit: AuditLog,
    readonly memory: MemoryStore,
  ) {
    this.registerInternalTools();
  }

  /** Memory tools are bound to the live store so agents can use them. */
  private registerInternalTools(): void {
    if (!this.registry.has('memory.search')) {
      this.registry.register({
        id: 'memory.search',
        name: 'Search memory',
        description: 'Search this agent\'s readable memory for a query.',
        category: 'memory',
        permissions: [],
        riskLevel: RiskLevel.LOW,
        requiresConfirmation: false,
        sideEffect: false,
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
        execute: async (input, ctx) => {
          const { query } = input as { query: string };
          const agent = ctx.data.agent as ChildAgent | undefined;
          const hits = this.memory.readable(
            ctx.agentId,
            agent?.memoryScope ?? 'PRIVATE',
            agent?.readableNamespaces ?? [],
            query,
          );
          return {
            ok: true,
            data: hits,
            summary: `${hits.length} memory record(s) matched "${query}".`,
          };
        },
      });
    }

    if (!this.registry.has('memory.write')) {
      this.registry.register({
        id: 'memory.write',
        name: 'Write memory',
        description: 'Store a durable fact in this agent\'s private memory.',
        category: 'memory',
        permissions: [],
        riskLevel: RiskLevel.LOW,
        requiresConfirmation: false,
        sideEffect: true,
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            value: { type: 'string' },
            kind: { type: 'string', enum: ['PREFERENCE', 'PROJECT', 'FACT'] },
          },
          required: ['key', 'value'],
        },
        execute: async (input, ctx) => {
          const { key, value, kind } = input as {
            key: string;
            value: string;
            kind?: 'PREFERENCE' | 'PROJECT' | 'FACT';
          };
          const rec = this.memory.write({
            ownerId: ctx.agentId,
            namespace: 'private',
            kind: kind ?? 'FACT',
            key,
            value,
            basis: 'agent_inferred',
          });
          return { ok: true, data: rec, summary: `Stored memory "${key}".` };
        },
      });
    }

    if (!this.registry.has('audit.read')) {
      this.registry.register({
        id: 'audit.read',
        name: 'Read audit log',
        description: 'Read recent audit entries, optionally for one agent.',
        category: 'internal',
        permissions: [],
        riskLevel: RiskLevel.LOW,
        requiresConfirmation: false,
        sideEffect: false,
        inputSchema: {
          type: 'object',
          properties: { agentId: { type: 'string' }, limit: { type: 'string' } },
        },
        execute: async (input) => {
          const { agentId, limit } = input as { agentId?: string; limit?: string };
          const n = limit ? Number(limit) : 50;
          const entries = agentId ? this.audit.forAgent(agentId, n) : this.audit.recent(n);
          return { ok: true, data: entries, summary: `${entries.length} audit entries.` };
        },
      });
    }
  }

  status(): RuntimeStatus {
    return {
      running: !this.emergencyStopped,
      emergencyStopped: this.emergencyStopped,
      activeTasks: this.activeTasks.size,
      pendingConfirmations: [...this.confirmations.values()].filter((c) => !c.resolved).length,
    };
  }

  /** EMERGENCY STOP — halt everything, preserve the audit trail. */
  emergencyStop(reason = 'User triggered the emergency stop.'): void {
    this.emergencyStopped = true;
    for (const c of this.confirmations.values()) c.resolved = true;
    this.audit.record({
      type: 'EMERGENCY_STOP',
      agentId: '__system__',
      decision: 'STOPPED',
      detail: reason,
    });
  }

  resume(): void {
    this.emergencyStopped = false;
    this.audit.record({
      type: 'EMERGENCY_STOP',
      agentId: '__system__',
      decision: 'RESUMED',
      detail: 'Emergency stop cleared by user.',
    });
  }

  /**
   * The single execution path. Returns an outcome rather than throwing so the
   * orchestrator can surface REQUIRES_CONFIRMATION and DENIED cleanly.
   */
  async executeTool(
    agent: ChildAgent,
    toolId: string,
    input: Record<string, unknown>,
    taskId: string,
    opts: { preAuthorised?: boolean } = {},
  ): Promise<ExecutionOutcome> {
    if (this.emergencyStopped) {
      return {
        status: 'DENIED',
        reason: 'KAIDO is stopped. Resume before any action can run.',
        risk: RiskLevel.LOW,
      };
    }

    const tool = this.registry.get(toolId);
    if (!tool) {
      this.audit.record({
        type: 'TOOL_FAILED',
        agentId: agent.id,
        taskId,
        tool: toolId,
        error: 'Tool not found.',
      });
      return { status: 'DENIED', reason: `Unknown tool: ${toolId}`, risk: RiskLevel.LOW };
    }

    if (!agent.tools.includes(toolId)) {
      return {
        status: 'DENIED',
        reason: `Agent "${agent.name}" is not assigned the tool ${toolId}.`,
        risk: RiskLevel.LOW,
      };
    }

    // Permission gate.
    const check = this.permissions.check(agent.id, tool.permissions);
    this.audit.record({
      type: 'PERMISSION_CHECKED',
      agentId: agent.id,
      taskId,
      tool: toolId,
      decision: check.granted ? 'GRANTED' : `MISSING:${check.missing.join(',')}`,
      detail: tool.permissions.join(', ') || 'no permissions required',
    });
    if (!check.granted) {
      return {
        status: 'DENIED',
        reason: `Missing permissions: ${check.missing.join(', ')}`,
        risk: RiskLevel.LOW,
      };
    }

    // Risk gate.
    const level = this.risk.assess(tool.riskLevel, {
      sideEffect: tool.sideEffect,
      crossBoundary: tool.sideEffect && tool.category !== 'internal',
    });
    const assessment = this.risk.evaluate(level, agent.confirmationPolicy, opts.preAuthorised === true);
    this.audit.record({
      type: 'RISK_ASSESSED',
      agentId: agent.id,
      taskId,
      tool: toolId,
      risk: level,
      decision: assessment.forbidden ? 'FORBIDDEN' : assessment.requiresConfirmation ? 'CONFIRM' : 'ALLOW',
      detail: assessment.reason,
    });

    if (assessment.forbidden) {
      return { status: 'FORBIDDEN', reason: assessment.reason, risk: level };
    }

    if (assessment.requiresConfirmation) {
      const confirmation: PendingConfirmation & { input: Record<string, unknown> } = {
        id: makeId('cnf'),
        agentId: agent.id,
        taskId,
        toolId,
        risk: level,
        preview: this.preview(agent, toolId, input),
        createdAt: nowIso(),
        resolved: false,
        input,
      };
      this.confirmations.set(confirmation.id, confirmation);
      this.audit.record({
        type: 'CONFIRMATION_REQUESTED',
        agentId: agent.id,
        taskId,
        tool: toolId,
        risk: level,
        decision: 'PENDING',
        detail: confirmation.preview,
      });
      return { status: 'REQUIRES_CONFIRMATION', confirmation };
    }

    return this.invoke(agent, toolId, input, taskId);
  }

  /** Perform the actual tool invocation. Called directly or after approval. */
  private async invoke(
    agent: ChildAgent,
    toolId: string,
    input: Record<string, unknown>,
    taskId: string,
  ): Promise<ExecutionOutcome> {
    const tool = this.registry.get(toolId)!;
    this.audit.record({
      type: 'TOOL_INVOKED',
      agentId: agent.id,
      taskId,
      tool: toolId,
      detail: JSON.stringify(input).slice(0, 500),
    });
    try {
      const result = await tool.execute(input, {
        agentId: agent.id,
        taskId,
        data: { agent },
      });
      this.audit.record({
        type: result.ok ? 'TOOL_COMPLETED' : 'TOOL_FAILED',
        agentId: agent.id,
        taskId,
        tool: toolId,
        decision: result.ok ? 'OK' : result.code ?? 'ERROR',
        detail: result.ok ? result.summary : result.error,
      });
      return {
        status: 'COMPLETED',
        result,
        risk: tool.riskLevel,
        actionsPerformed: [`${toolId}: ${result.ok ? 'ok' : 'failed'}`],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.audit.record({
        type: 'TOOL_FAILED',
        agentId: agent.id,
        taskId,
        tool: toolId,
        error: message,
      });
      return { status: 'COMPLETED', result: { ok: false, error: message }, risk: tool.riskLevel, actionsPerformed: [] };
    }
  }

  /** Resolve a pending confirmation, then execute if granted. */
  async resolveConfirmation(
    confirmationId: string,
    granted: boolean,
    agents: Map<string, ChildAgent>,
  ): Promise<ExecutionOutcome | null> {
    const pending = this.confirmations.get(confirmationId);
    if (!pending || pending.resolved) return null;
    pending.resolved = true;
    pending.granted = granted;
    const agent = agents.get(pending.agentId);
    if (!agent) return null;
    this.audit.record({
      type: granted ? 'CONFIRMATION_GRANTED' : 'CONFIRMATION_DENIED',
      agentId: agent.id,
      taskId: pending.taskId,
      tool: pending.toolId,
      risk: pending.risk,
      decision: granted ? 'GRANTED' : 'DENIED',
    });
    if (!granted) {
      return {
        status: 'DENIED',
        reason: 'User denied the action at the confirmation gate.',
        risk: pending.risk,
      };
    }
    // Re-run the tool; the pending entry recorded the input preview only, so we
    // re-execute via a stored input if present.
    const input = (pending as PendingConfirmation & { input?: Record<string, unknown> }).input ?? {};
    return this.invoke(agent, pending.toolId, input, pending.taskId);
  }

  pendingConfirmations(): PendingConfirmation[] {
    return [...this.confirmations.values()].filter((c) => !c.resolved);
  }

  beginTask(taskId: string): void {
    this.activeTasks.add(taskId);
  }

  endTask(taskId: string): void {
    this.activeTasks.delete(taskId);
  }

  private preview(agent: ChildAgent, toolId: string, input: Record<string, unknown>): string {
    return `${agent.name} wants to run ${toolId} with ${JSON.stringify(input).slice(0, 300)}`;
  }
}

export type { AgentTask, AgentResult, Permission };
