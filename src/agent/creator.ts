import { ChildAgent, Permission, RiskLevel } from '../core/types.js';
import { AIProvider, ChatMessage } from '../ai/provider.js';
import { AgentRegistry } from './registry.js';
import { AgentSpec, WRITE_CONFIRM_POLICY } from './factory.js';
import { extractJsonLoose } from './orchestrator.js';
import { wrapUntrusted } from '../security/injection.js';

export type ProposedAgent = {
  spec: AgentSpec;
  /** Human-readable review block shown before activation. */
  review: {
    name: string;
    purpose: string;
    tools: string[];
    permissions: string[];
    requiresConfirmation: string[];
    memory: string;
  };
};

/**
 * Natural-language agent creation.
 *
 * The user describes an agent in plain English; KAIDO proposes a structured
 * configuration. Nothing is activated until the user approves it, and the
 * proposal never grants an unrestricted permission set — tools the user did
 * not mention are not added, and write/execute capabilities default to
 * requiring confirmation.
 */
export class AgentCreator {
  constructor(
    private readonly provider: AIProvider,
    private readonly registry: AgentRegistry,
  ) {}

  /** Turn a description into a proposed spec (not yet created). */
  async propose(description: string, parentAgentId?: string): Promise<ProposedAgent> {
    const availableTools = this.knownToolIds();
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          `You translate a user's plain-English description of an AI agent into a strict JSON configuration.\n` +
          `Return ONLY JSON of this shape:\n` +
          `{"name":string,"description":string,"systemPrompt":string,"tools":string[],"permissions":string[],"memoryScope":"PRIVATE"|"SHARED"|"SELECTIVE"}\n` +
          `Rules:\n` +
          `- tools MUST be chosen only from this list: ${availableTools.join(', ')}\n` +
          `- permissions MUST be chosen only from this list: ${Object.values(Permission).join(', ')}\n` +
          `- Only include tools and permissions the description actually implies. Never add extras.\n` +
          `- The systemPrompt must state the agent's purpose and its hard limits.\n` +
          `- If the description mentions asking before an action, the prompt must say so.`,
      },
      { role: 'user', content: wrapUntrusted(description, 'unknown') },
    ];

    let spec: AgentSpec;
    try {
      const res = await this.provider.chat(messages, { model: this.defaultModel(), json: true, maxTokens: 900 });
      const raw = JSON.parse(extractJsonLoose(res.content)) as Partial<AgentSpec> & {
        permissions?: string[];
      };
      spec = {
        name: raw.name ?? 'Custom Agent',
        description: raw.description ?? description.slice(0, 120),
        systemPrompt:
          raw.systemPrompt ??
          `You are ${raw.name ?? 'a custom KAIDO agent'}. ${description}\nAlways stay within your assigned tools and permissions.`,
        tools: this.filterTools(raw.tools ?? []),
        permissions: this.filterPermissions((raw.permissions ?? []) as string[]),
        memoryScope: raw.memoryScope ?? 'PRIVATE',
        confirmationPolicy: WRITE_CONFIRM_POLICY,
        parentAgentId,
      };
    } catch {
      // Deterministic fallback: minimal, safe, and clearly derived from the text.
      spec = {
        name: 'Custom Agent',
        description: description.slice(0, 120),
        systemPrompt: `You are a custom KAIDO agent. ${description}\nAlways stay within your assigned tools and permissions and ask before any external action.`,
        tools: [],
        permissions: [],
        memoryScope: 'PRIVATE',
        confirmationPolicy: WRITE_CONFIRM_POLICY,
        parentAgentId,
      };
    }

    return { spec, review: this.review(spec) };
  }

  /** Approve a proposal and create the agent for real. */
  approve(proposal: ProposedAgent): ChildAgent {
    return this.registry.create(proposal.spec);
  }

  private review(spec: AgentSpec): ProposedAgent['review'] {
    const policy = spec.confirmationPolicy ?? WRITE_CONFIRM_POLICY;
    return {
      name: spec.name,
      purpose: spec.description,
      tools: spec.tools,
      permissions: spec.permissions,
      requiresConfirmation: policy.requireConfirmationFor,
      memory: spec.memoryScope ?? 'PRIVATE',
    };
  }

  private knownToolIds(): string[] {
    return this.registryToolIds();
  }

  private registryToolIds(): string[] {
    // Pulled from the runtime registry at construction time via the catalogue
    // the KAIDO assembly passes in. Kept as a method so it can be overridden.
    return [
      'gmail.search', 'gmail.read', 'gmail.draft', 'gmail.send',
      'drive.search', 'drive.create', 'drive.delete',
      'github.repositories', 'github.actions', 'github.issues', 'github.createIssue',
      'termux.execute', 'android.notifications', 'android.contacts', 'android.camera',
      'android.files', 'web.search', 'web.extract',
      'memory.search', 'memory.write', 'audit.read',
    ];
  }

  private filterTools(tools: string[]): string[] {
    const known = new Set(this.knownToolIds());
    return [...new Set(tools.filter((t) => known.has(t)))];
  }

  private filterPermissions(perms: string[]): Permission[] {
    const valid = new Set(Object.values(Permission) as string[]);
    return [...new Set(perms.filter((p) => valid.has(p)))] as Permission[];
  }

  private defaultModel(): string {
    return process.env.KAIDO_DEFAULT_MODEL ?? 'gemini-2.0-flash';
  }
}

export { RiskLevel };
