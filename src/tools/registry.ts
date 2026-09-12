import { AgentTool, ToolCategory, RiskLevel } from '../core/types.js';

/**
 * The ToolRegistry is the single source of truth for what KAIDO can do.
 * Every tool is registered centrally; an agent only ever receives the
 * subset assigned to it, and only after the runtime has verified that its
 * permissions cover the tool's declared requirements.
 */
export class ToolRegistry {
  private tools = new Map<string, AgentTool<any, any>>();

  register(tool: AgentTool<any, any>): void {
    if (this.tools.has(tool.id)) {
      throw new Error(`Tool already registered: ${tool.id}`);
    }
    this.tools.set(tool.id, tool);
  }

  registerAll(tools: AgentTool<any, any>[]): void {
    for (const t of tools) this.register(t);
  }

  get(id: string): AgentTool<any, any> | undefined {
    return this.tools.get(id);
  }

  has(id: string): boolean {
    return this.tools.has(id);
  }

  list(): AgentTool<any, any>[] {
    return [...this.tools.values()];
  }

  byCategory(category: ToolCategory): AgentTool<any, any>[] {
    return this.list().filter((t) => t.category === category);
  }

  byRisk(maxLevel: RiskLevel, order: RiskLevel[]): AgentTool<any, any>[] {
    const ceiling = order.indexOf(maxLevel);
    return this.list().filter((t) => order.indexOf(t.riskLevel) <= ceiling);
  }

  /** Compact catalogue for the Master Agent's planning prompt. */
  catalogue(): { id: string; description: string; category: string; risk: string }[] {
    return this.list().map((t) => ({
      id: t.id,
      description: t.description,
      category: t.category,
      risk: t.riskLevel,
    }));
  }
}
