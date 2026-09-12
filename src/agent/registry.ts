import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ChildAgent, Permission } from '../core/types.js';
import { AgentFactory, AgentSpec } from './factory.js';
import { PermissionManager } from '../security/permissions.js';
import { AuditLog } from '../security/audit.js';

/**
 * The AgentRegistry owns the set of agents. Agent configuration is stored as
 * plain JSON so it survives restarts and can be exported/imported. Version
 * history is kept per agent; secrets are never part of an agent record.
 */
export class AgentRegistry {
  private agents = new Map<string, ChildAgent>();
  private history = new Map<string, ChildAgent[]>();
  private readonly file: string | null;

  constructor(
    private readonly factory: AgentFactory,
    private readonly permissions: PermissionManager,
    private readonly audit: AuditLog,
    dataDir: string | null = null,
  ) {
    if (dataDir) {
      mkdirSync(dataDir, { recursive: true });
      this.file = join(dataDir, 'agents.json');
      this.load();
    } else {
      this.file = null;
    }
  }

  private load(): void {
    if (!this.file || !existsSync(this.file)) return;
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as {
        agents: ChildAgent[];
        history: Record<string, ChildAgent[]>;
      };
      for (const a of raw.agents ?? []) {
        this.agents.set(a.id, a);
        this.permissions.setPermissions(a.id, a.permissions);
      }
      for (const [id, versions] of Object.entries(raw.history ?? {})) {
        this.history.set(id, versions);
      }
    } catch {
      /* start clean on a corrupt store rather than crash */
    }
  }

  private persist(): void {
    if (!this.file) return;
    writeFileSync(
      this.file,
      JSON.stringify(
        { agents: [...this.agents.values()], history: Object.fromEntries(this.history) },
        null,
        2,
      ),
      'utf8',
    );
  }

  create(spec: AgentSpec): ChildAgent {
    const agent = this.factory.create(spec);
    this.agents.set(agent.id, agent);
    this.permissions.setPermissions(agent.id, agent.permissions);
    if (agent.parentAgentId) {
      const parent = this.agents.get(agent.parentAgentId);
      if (parent) {
        parent.childAgentIds.push(agent.id);
        parent.updatedAt = new Date().toISOString();
      }
    }
    this.history.set(agent.id, [agent]);
    this.persist();
    this.audit.record({
      type: 'AGENT_CREATED',
      agentId: agent.id,
      detail: `${agent.name} v${agent.version}`,
    });
    return agent;
  }

  revise(id: string, patch: Partial<AgentSpec>): ChildAgent {
    const current = this.require(id);
    const next = this.factory.revise(current, patch);
    this.agents.set(id, next);
    this.permissions.setPermissions(id, next.permissions);
    const versions = this.history.get(id) ?? [];
    versions.push(next);
    this.history.set(id, versions);
    this.persist();
    this.audit.record({
      type: 'AGENT_UPDATED',
      agentId: id,
      detail: `${next.name} → v${next.version}`,
    });
    return next;
  }

  clone(id: string, newName?: string): ChildAgent {
    const source = this.require(id);
    return this.create({
      name: newName ?? `${source.name} (copy)`,
      description: source.description,
      icon: source.icon,
      systemPrompt: source.systemPrompt,
      model: source.model,
      tools: [...source.tools],
      integrations: [...source.integrations],
      permissions: [...source.permissions],
      memoryScope: source.memoryScope,
      readableNamespaces: [...source.readableNamespaces],
      confirmationPolicy: source.confirmationPolicy,
      parentAgentId: source.parentAgentId,
    });
  }

  delete(id: string): boolean {
    const agent = this.agents.get(id);
    if (!agent) return false;
    if (agent.parentAgentId) {
      const parent = this.agents.get(agent.parentAgentId);
      if (parent) {
        parent.childAgentIds = parent.childAgentIds.filter((c) => c !== id);
      }
    }
    for (const child of this.children(id)) {
      child.parentAgentId = undefined;
    }
    this.agents.delete(id);
    this.permissions.removeAgent(id);
    this.persist();
    this.audit.record({ type: 'AGENT_DELETED', agentId: id, detail: agent.name });
    return true;
  }

  setEnabled(id: string, enabled: boolean): ChildAgent {
    const agent = this.require(id);
    agent.enabled = enabled;
    agent.updatedAt = new Date().toISOString();
    this.persist();
    return agent;
  }

  get(id: string): ChildAgent | undefined {
    return this.agents.get(id);
  }

  require(id: string): ChildAgent {
    const a = this.agents.get(id);
    if (!a) throw new Error(`Agent not found: ${id}`);
    return a;
  }

  byName(name: string): ChildAgent | undefined {
    const n = name.trim().toLowerCase();
    return [...this.agents.values()].find((a) => a.name.toLowerCase() === n);
  }

  list(): ChildAgent[] {
    return [...this.agents.values()];
  }

  children(id: string): ChildAgent[] {
    return this.list().filter((a) => a.parentAgentId === id);
  }

  roots(): ChildAgent[] {
    return this.list().filter((a) => !a.parentAgentId);
  }

  versions(id: string): ChildAgent[] {
    return this.history.get(id) ?? [];
  }

  rollback(id: string, version: number): ChildAgent {
    const versions = this.history.get(id) ?? [];
    const target = versions.find((v) => v.version === version);
    if (!target) throw new Error(`Version ${version} not found for agent ${id}.`);
    const restored = this.factory.revise(target, {});
    const next = { ...restored, version: this.require(id).version + 1 };
    this.agents.set(id, next);
    this.permissions.setPermissions(id, next.permissions);
    versions.push(next);
    this.persist();
    this.audit.record({
      type: 'AGENT_UPDATED',
      agentId: id,
      detail: `Rolled back to v${version} as v${next.version}`,
    });
    return next;
  }

  /** Export a portable config. Permissions and prompts only — never secrets. */
  export(id: string): { agent: ChildAgent; exportedAt: string } {
    const agent = this.require(id);
    return { agent, exportedAt: new Date().toISOString() };
  }

  map(): Map<string, ChildAgent> {
    return new Map(this.agents);
  }

  setPermission(id: string, permission: Permission, granted: boolean): ChildAgent {
    const agent = this.require(id);
    if (granted && !agent.permissions.includes(permission)) {
      agent.permissions.push(permission);
      this.permissions.grant(id, permission);
    } else if (!granted) {
      agent.permissions = agent.permissions.filter((p) => p !== permission);
      this.permissions.revoke(id, permission);
    }
    agent.updatedAt = new Date().toISOString();
    this.persist();
    return agent;
  }
}
