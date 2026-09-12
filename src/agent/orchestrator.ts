import { makeId, nowIso } from '../core/ids.js';
import {
  AgentResult,
  AgentTask,
  ChildAgent,
  RiskLevel,
  ToolResult,
} from '../core/types.js';
import { AgentRegistry } from './registry.js';
import { AgentRuntime } from './runtime.js';
import { AuditLog } from '../security/audit.js';
import { AIProvider, ChatMessage } from '../ai/provider.js';
import { UNTRUSTED_CONTENT_POLICY, wrapUntrusted } from '../security/injection.js';

export type DelegationPlanStep = {
  step: number;
  agentName: string;
  objective: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'awaiting_confirmation';
};

export type DelegationPlan = {
  id: string;
  goal: string;
  steps: DelegationPlanStep[];
  createdAt: string;
};

export type TaskOutcome = {
  taskId: string;
  summary: string;
  results: AgentResult[];
  actionsPerformed: string[];
  requiresUserAction: boolean;
  pendingConfirmations: { id: string; preview: string }[];
};

/**
 * The Master Agent (KAIDO) — the orchestrator.
 *
 * Responsibilities, in order: understand the request, determine which agent
 * or agents can serve it, produce a plan, delegate, collect results, and
 * surface any action that needs the user's approval. It never executes
 * anything itself: every effect goes through AgentRuntime.
 */
export class MasterOrchestrator {
  constructor(
    private readonly registry: AgentRegistry,
    private readonly runtime: AgentRuntime,
    private readonly audit: AuditLog,
    private readonly provider: AIProvider,
  ) {}

  /** Route a free-text instruction to the best-matching enabled agent. */
  route(objective: string): ChildAgent | undefined {
    const q = objective.toLowerCase();
    const candidates = this.registry.list().filter((a) => a.enabled);
    let best: { agent: ChildAgent; score: number } | undefined;
    for (const agent of candidates) {
      let score = 0;
      const hay = `${agent.name} ${agent.description} ${agent.integrations.join(' ')}`.toLowerCase();
      for (const token of q.split(/\s+/)) {
        if (token.length > 2 && hay.includes(token)) score += 1;
      }
      // Keyword affinity map — an explicit, inspectable routing table.
      const affinities: Record<string, string[]> = {
        code: ['code', 'bug', 'test', 'repo', 'repository', 'compile', 'typescript', 'build', 'pull request'],
        research: ['research', 'find', 'search', 'compare', 'source', 'article', 'web'],
        devops: ['deploy', 'deployment', 'ci', 'cd', 'workflow', 'actions', 'pipeline', 'logs'],
        email: ['email', 'gmail', 'inbox', 'mail', 'draft'],
        publisher: ['publish', 'announce', 'post', 'content', 'release', 'newsletter'],
        whatsapp: ['whatsapp', 'message', 'messages', 'chat', 'notification', 'reply'],
        file: ['file', 'files', 'folder', 'drive', 'document', 'organise', 'organize'],
        security: ['security', 'audit', 'permission', 'injection', 'suspicious'],
      };
      for (const [tmpl, words] of Object.entries(affinities)) {
        if (agent.name.toLowerCase().includes(tmpl) || agent.integrations.some((i) => i.includes(tmpl))) {
          for (const w of words) if (q.includes(w)) score += 3;
        }
      }
      if (!best || score > best.score) best = { agent, score };
    }
    return best && best.score > 0 ? best.agent : undefined;
  }

  /** Build an explicit plan from a goal, using the provider when available. */
  async plan(goal: string): Promise<DelegationPlan> {
    const agents = this.registry.list().filter((a) => a.enabled);
    const prompt: ChatMessage[] = [
      {
        role: 'system',
        content:
          `You are KAIDO Master Agent, the orchestrator of a personal AI agent OS.\n` +
          `Decompose the user's goal into 1-5 sequential steps, each assigned to exactly one agent from this list:\n` +
          agents.map((a) => `- ${a.name}: ${a.description}`).join('\n') +
          `\nReturn strict JSON: {"steps":[{"agentName":"...","objective":"..."}]}. ` +
          `Choose the minimum number of steps.`,
      },
      { role: 'user', content: wrapUntrusted(goal, 'unknown') },
    ];
    const steps: DelegationPlanStep[] = [];
    try {
      const res = await this.provider.chat(prompt, { model: agents[0]?.model ?? 'gemini-2.0-flash', json: true, maxTokens: 800 });
      const parsed = JSON.parse(extractJsonLoose(res.content)) as {
        steps?: { agentName: string; objective: string }[];
      };
      (parsed.steps ?? []).forEach((s, i) => {
        steps.push({ step: i + 1, agentName: s.agentName, objective: s.objective, status: 'pending' });
      });
    } catch {
      /* fall through to the deterministic single-step plan */
    }
    if (steps.length === 0) {
      const agent = this.route(goal);
      steps.push({
        step: 1,
        agentName: agent?.name ?? '(none)',
        objective: goal,
        status: 'pending',
      });
    }
    return { id: makeId('plan'), goal, steps, createdAt: nowIso() };
  }

  /**
   * Execute a delegation: the Master Agent hands a task to a child agent,
   * which returns a structured AgentResult.
   */
  async delegate(task: AgentTask): Promise<AgentResult> {
    const agent = this.registry.get(task.targetAgentId);
    if (!agent) {
      return {
        taskId: task.id,
        status: 'FAILED',
        summary: `Target agent not found: ${task.targetAgentId}`,
        actionsPerformed: [],
        errors: ['AGENT_NOT_FOUND'],
      };
    }
    if (!agent.enabled) {
      return {
        taskId: task.id,
        status: 'FAILED',
        summary: `Agent "${agent.name}" is disabled.`,
        actionsPerformed: [],
        errors: ['AGENT_DISABLED'],
      };
    }
    this.audit.record({
      type: 'AGENT_DELEGATED',
      agentId: task.parentAgentId,
      taskId: task.id,
      detail: `→ ${agent.name}: ${task.objective}`,
    });
    const outcome = await this.runAgentTask(agent, task);
    this.audit.record({
      type: 'AGENT_RESULT',
      agentId: agent.id,
      taskId: task.id,
      decision: outcome.status,
      detail: outcome.summary,
    });
    return outcome;
  }

  /** Run one agent against one objective, honouring its tools and policy. */
  async runAgentTask(agent: ChildAgent, task: AgentTask): Promise<AgentResult> {
    const actionsPerformed: string[] = [];
    const errors: string[] = [];
    const pending: { id: string; preview: string }[] = [];

    const allowed = task.allowedTools ?? agent.tools;
    // Restrict to tools the agent actually holds AND the caller allows.
    const effectiveTools = agent.tools.filter((t) => allowed.includes(t));

    const toolCatalogue = effectiveTools
      .map((id) => {
        const t = this.runtime.registry.get(id);
        return t ? `- ${t.id}: ${t.description}` : null;
      })
      .filter(Boolean)
      .join('\n');

    const messages: ChatMessage[] = [
      { role: 'system', content: `${agent.systemPrompt}\n\n${UNTRUSTED_CONTENT_POLICY}\n\nAvailable tools:\n${toolCatalogue}` },
      {
        role: 'user',
        content:
          `Objective: ${wrapUntrusted(task.objective, 'unknown')}\n\n` +
          `Respond with strict JSON: {"summary": string, "toolCalls": [{"tool": string, "input": object}]}. ` +
          `Use only the tools listed above. If no tool is needed, return an empty toolCalls array.`,
      },
    ];

    let summary = '';
    let toolCalls: { tool: string; input: Record<string, unknown> }[] = [];
    try {
      const res = await this.provider.chat(messages, {
        model: agent.model,
        json: true,
        maxTokens: 1200,
      });
      const parsed = JSON.parse(extractJsonLoose(res.content)) as {
        summary?: string;
        toolCalls?: { tool: string; input: Record<string, unknown> }[];
      };
      summary = parsed.summary ?? '';
      toolCalls = Array.isArray(parsed.toolCalls) ? parsed.toolCalls : [];
    } catch (err) {
      errors.push(`PLAN_ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }

    for (const call of toolCalls) {
      if (!effectiveTools.includes(call.tool)) {
        errors.push(`REFUSED_TOOL: ${call.tool} is not available to ${agent.name}`);
        continue;
      }
      const outcome = await this.runtime.executeTool(agent, call.tool, call.input ?? {}, task.id, {
        preAuthorised: task.requireConfirmation === false && false,
      });
      switch (outcome.status) {
        case 'COMPLETED':
          actionsPerformed.push(`${call.tool}: ${(outcome.result as ToolResult).ok ? 'ok' : 'failed'}`);
          if (!outcome.result.ok) errors.push(`${call.tool}: ${outcome.result.error}`);
          break;
        case 'REQUIRES_CONFIRMATION':
          pending.push({ id: outcome.confirmation.id, preview: outcome.confirmation.preview });
          break;
        case 'DENIED':
          errors.push(`DENIED ${call.tool}: ${outcome.reason}`);
          break;
        case 'FORBIDDEN':
          errors.push(`FORBIDDEN ${call.tool}: ${outcome.reason}`);
          break;
      }
    }

    if (pending.length > 0) {
      return {
        taskId: task.id,
        status: 'REQUIRES_CONFIRMATION',
        summary: summary || `${agent.name} is waiting for approval.`,
        actionsPerformed,
        errors: errors.length ? errors : undefined,
        requiresUserAction: true,
        output: { pendingConfirmations: pending },
      };
    }
    if (errors.length > 0 && actionsPerformed.length === 0) {
      return {
        taskId: task.id,
        status: 'FAILED',
        summary: summary || `${agent.name} could not complete the task.`,
        actionsPerformed,
        errors,
      };
    }
    return {
      taskId: task.id,
      status: 'SUCCESS',
      summary: summary || `${agent.name} completed the task.`,
      actionsPerformed,
      errors: errors.length ? errors : undefined,
      output: { risk: RiskLevel.LOW },
    };
  }

  /** Full multi-step orchestration over a plan. */
  async executePlan(plan: DelegationPlan, parentAgentId: string): Promise<TaskOutcome> {
    const results: AgentResult[] = [];
    const allPending: { id: string; preview: string }[] = [];
    let requiresUserAction = false;

    for (const step of plan.steps) {
      const agent = this.registry.byName(step.agentName) ?? this.route(step.objective);
      if (!agent) {
        step.status = 'failed';
        results.push({
          taskId: makeId('task'),
          status: 'FAILED',
          summary: `No agent could handle: ${step.objective}`,
          actionsPerformed: [],
          errors: ['NO_AGENT_MATCH'],
        });
        continue;
      }
      step.status = 'running';
      const taskId = makeId('task');
      this.runtime.beginTask(taskId);
      const result = await this.delegate({
        id: taskId,
        parentAgentId,
        targetAgentId: agent.id,
        objective: step.objective,
        context: { goal: plan.goal, step: step.step },
      });
      this.runtime.endTask(taskId);
      results.push(result);
      if (result.status === 'REQUIRES_CONFIRMATION') {
        step.status = 'awaiting_confirmation';
        requiresUserAction = true;
        const out = result.output as { pendingConfirmations?: { id: string; preview: string }[] };
        allPending.push(...(out?.pendingConfirmations ?? []));
        break; // do not run later steps until the user decides
      }
      step.status = result.status === 'SUCCESS' ? 'done' : 'failed';
    }

    return {
      taskId: plan.id,
      summary: results.map((r) => r.summary).filter(Boolean).join(' '),
      results,
      actionsPerformed: results.flatMap((r) => r.actionsPerformed),
      requiresUserAction,
      pendingConfirmations: allPending,
    };
  }
}

/** Tolerant JSON extractor for provider output. */
export function extractJsonLoose(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1]! : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  return start === -1 || end === -1 ? body.trim() : body.slice(start, end + 1);
}
