import { AgentRegistry } from './agent/registry.js';
import { AgentFactory } from './agent/factory.js';
import { AgentRuntime } from './agent/runtime.js';
import { MasterOrchestrator } from './agent/orchestrator.js';
import { AgentCreator } from './agent/creator.js';
import { TEMPLATES, findTemplate } from './agent/templates.js';
import { AuditLog } from './security/audit.js';
import { PermissionManager } from './security/permissions.js';
import { RiskEngine } from './security/risk.js';
import { ToolRegistry } from './tools/registry.js';
import { BUILTIN_TOOLS } from './tools/builtin.js';
import { MemoryStore } from './memory/store.js';
import { EventBus, AutomationEngine } from './automation/engine.js';
import { AIProvider } from './ai/provider.js';
import { createProvider as makeProvider } from './ai/index.js';
import { ChildAgent, RuntimeStatus } from './core/types.js';
import { nowIso } from './core/ids.js';
import { AdapterRegistry, AdapterInfo } from './adapters/types.js';
import { FilesAdapter } from './adapters/files.js';
import { WebAdapter } from './adapters/web.js';
import { TermuxAdapter } from './adapters/termux.js';
import { createAdapterTools } from './adapters/tools.js';

export type KaidoOptions = {
  dataDir?: string | null;
  provider?: AIProvider;
  /** Minimal set of tools; used by tests to constrain the surface. */
  tools?: typeof BUILTIN_TOOLS;
  /** Mount platform adapters. Off by default so tests stay hermetic. */
  adapters?: boolean;
  /** Root directory the files adapter is scoped to. */
  projectRoot?: string;
};

export type DelegationRecord = {
  id: string;
  at: string;
  targetAgentId: string;
  objective: string;
  status: string;
  summary: string;
};

/**
 * KAIDO — the assembled system.
 *
 * Wiring order matters: tools must exist before the runtime, permissions
 * before any agent, and the audit log before anything that could fail so
 * failures are recorded rather than swallowed.
 */
export class Kaido {
  readonly tools: ToolRegistry;
  readonly permissions: PermissionManager;
  readonly risk = new RiskEngine();
  readonly audit: AuditLog;
  readonly memory: MemoryStore;
  readonly registry: AgentRegistry;
  readonly runtime: AgentRuntime;
  readonly orchestrator: MasterOrchestrator;
  readonly creator: AgentCreator;
  readonly bus = new EventBus();
  readonly automations: AutomationEngine;
  readonly provider: AIProvider;
  readonly adapters = new AdapterRegistry();

  /** The Master Agent record — created on first boot if absent. */
  master!: ChildAgent;

  private delegationLog: DelegationRecord[] = [];

  constructor(options: KaidoOptions = {}) {
    const dataDir = options.dataDir ?? null;

    this.audit = new AuditLog(dataDir);
    this.memory = new MemoryStore(dataDir);
    this.permissions = new PermissionManager();
    this.tools = new ToolRegistry();
    this.tools.registerAll(options.tools ?? BUILTIN_TOOLS);

    // Adapter tools replace the phase-1..3 placeholders. They are always
    // registered; whether they DO anything depends on what is mounted below.
    this.tools.registerAll(createAdapterTools(this.adapters));

    if (options.adapters) {
      this.mountDefaultAdapters(options.projectRoot ?? process.cwd());
    }

    this.runtime = new AgentRuntime(
      this.tools,
      this.permissions,
      this.risk,
      this.audit,
      this.memory,
    );

    this.registry = new AgentRegistry(
      new AgentFactory(),
      this.permissions,
      this.audit,
      dataDir,
    );

    this.provider = options.provider ?? makeProvider();
    this.orchestrator = new MasterOrchestrator(
      this.registry,
      this.runtime,
      this.audit,
      this.provider,
    );
    this.creator = new AgentCreator(this.provider, this.registry);

    this.automations = new AutomationEngine(this.bus, async (automation, event) => {
      this.audit.record({
        type: 'AUTOMATION_TRIGGERED',
        agentId: automation.ownerAgentId,
        decision: 'RUN',
        detail: `${automation.name} ← ${event.type}`,
      });
      for (const action of automation.actions) {
        if (action.kind === 'notify') {
          this.audit.record({
            type: 'AGENT_RESULT',
            agentId: automation.ownerAgentId,
            decision: 'NOTIFY',
            detail: action.message,
          });
        } else if (action.kind === 'delegate') {
          const target = this.registry.get(action.targetAgentId) ?? this.registry.byName(action.targetAgentId);
          if (target) {
            await this.orchestrator.delegate({
              id: `auto_${event.id}`,
              parentAgentId: automation.ownerAgentId,
              targetAgentId: target.id,
              objective: action.objective,
              context: event.payload,
              requireConfirmation: !automation.preAuthorised,
            });
          }
        } else if (action.kind === 'tool') {
          const owner = this.registry.get(automation.ownerAgentId);
          if (owner) {
            await this.runtime.executeTool(owner, action.toolId, action.input, `auto_${event.id}`, {
              preAuthorised: automation.preAuthorised,
            });
          }
        }
      }
    });

    this.bootstrapMaster();
  }

  /** Ensure the Master Agent exists. Templates can then be instantiated as children. */
  private bootstrapMaster(): void {
    const existing =
      this.registry.byName('KAIDO') ?? this.registry.list().find((a) => !a.parentAgentId);
    if (existing) {
      this.master = existing;
      return;
    }
    this.master = this.registry.create({
      name: 'KAIDO',
      description: 'Master Agent — orchestrator of the KAIDO agent OS.',
      icon: 'sparkle',
      systemPrompt:
        'You are KAIDO, the Master Agent. You understand the user\'s request, choose the ' +
        'right child agent, delegate, coordinate multiple agents, and report the result. ' +
        'You never execute a tool yourself; every action flows through the Agent Runtime.',
      tools: [],
      permissions: [],
      memoryScope: 'SHARED',
    });
  }

  /** Instantiate a built-in template as a child of the Master Agent. */
  instantiateTemplate(templateId: string): ChildAgent {
    const template = findTemplate(templateId);
    if (!template) throw new Error(`Unknown template: ${templateId}`);
    if (this.registry.byName(template.spec.name)) {
      return this.registry.byName(template.spec.name)!;
    }
    return this.registry.create({ ...template.spec, parentAgentId: this.master.id });
  }

  instantiateAllTemplates(): ChildAgent[] {
    return TEMPLATES.map((t) => this.instantiateTemplate(t.id));
  }

  status(): RuntimeStatus & { agents: number } {
    return { ...this.runtime.status(), agents: this.registry.list().length };
  }

  /**
   * Mount the platform adapters that are safe and useful by default:
   * files (scoped to the project root), web (fetch + extract), and Termux
   * (which reports NOT_MOUNTED until explicitly armed).
   */
  mountDefaultAdapters(projectRoot: string): void {
    this.adapters.mount(new FilesAdapter(projectRoot));
    this.adapters.mount(new WebAdapter());
    this.adapters.mount(new TermuxAdapter({ root: projectRoot }));
  }

  /** Why the last planning call failed — surfaced so it is never silent. */
  get lastPlannerError(): string | null {
    return this.orchestrator.lastPlannerError;
  }

  /** True state of every mounted adapter — never a guess. */
  async adapterStatus(): Promise<AdapterInfo[]> {
    return this.adapters.status();
  }

  /**
   * The top-level entry point: give KAIDO a goal, get back what happened.
   * Plans, delegates, and stops at a confirmation gate if one is reached.
   */
  async ask(goal: string): Promise<{
    plan: { id: string; goal: string; steps: { step: number; agentName: string; objective: string; status: string }[] };
    outcome: Awaited<ReturnType<MasterOrchestrator['executePlan']>>;
  }> {
    const plan = await this.orchestrator.plan(goal);
    const outcome = await this.orchestrator.executePlan(plan, this.master.id);
    for (const r of outcome.results) {
      this.delegationLog.push({
        id: r.taskId,
        at: nowIso(),
        targetAgentId: this.master.id,
        objective: goal,
        status: r.status,
        summary: r.summary,
      });
    }
    return { plan, outcome };
  }

  /** Directly route a goal to one agent without multi-step planning. */
  async askAgent(agentName: string, objective: string) {
    const agent = this.registry.byName(agentName);
    if (!agent) throw new Error(`Agent not found: ${agentName}`);
    const taskId = `task_${Date.now().toString(36)}`;
    this.runtime.beginTask(taskId);
    try {
      return await this.orchestrator.delegate({
        id: taskId,
        parentAgentId: this.master.id,
        targetAgentId: agent.id,
        objective,
        context: {},
      });
    } finally {
      this.runtime.endTask(taskId);
    }
  }

  delegations(): DelegationRecord[] {
    return [...this.delegationLog];
  }

  stop(): void {
    this.runtime.emergencyStop();
  }

  resume(): void {
    this.runtime.resume();
  }
}

export * from './core/types.js';
export { TEMPLATES };
export type { AgentSpec } from './agent/factory.js';
export type { ProposedAgent } from './agent/creator.js';
