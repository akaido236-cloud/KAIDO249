import { Permission } from '../core/types.js';

/**
 * Permission mapping: which permission each tool category requires.
 * Used by the PermissionManager as a second line of defence behind each
 * tool's own declared `permissions` array.
 */
export const CATEGORY_BASELINE: Record<string, Permission[]> = {
  email: [Permission.READ_EMAIL],
  drive: [Permission.READ_DRIVE],
  github: [Permission.READ_GITHUB],
  android: [],
  termux: [Permission.TERMUX_EXECUTION],
  web: [Permission.WEB_READ],
  files: [Permission.FILES_READ],
};

export type PermissionCheck = {
  granted: boolean;
  missing: Permission[];
};

/**
 * The PermissionManager is the single gate every tool invocation passes
 * through. An agent holds only the permissions explicitly assigned to it —
 * a child agent never inherits the Master Agent's set.
 */
export class PermissionManager {
  private grants = new Map<string, Set<Permission>>();

  setPermissions(agentId: string, permissions: Permission[]): void {
    this.grants.set(agentId, new Set(permissions));
  }

  grant(agentId: string, permission: Permission): void {
    const set = this.grants.get(agentId) ?? new Set<Permission>();
    set.add(permission);
    this.grants.set(agentId, set);
  }

  revoke(agentId: string, permission: Permission): void {
    this.grants.get(agentId)?.delete(permission);
  }

  list(agentId: string): Permission[] {
    return [...(this.grants.get(agentId) ?? new Set())];
  }

  has(agentId: string, permission: Permission): boolean {
    return this.grants.get(agentId)?.has(permission) ?? false;
  }

  /** Verify an agent holds every permission a tool requires. */
  check(agentId: string, required: Permission[]): PermissionCheck {
    const missing = required.filter((p) => !this.has(agentId, p));
    return { granted: missing.length === 0, missing };
  }

  removeAgent(agentId: string): void {
    this.grants.delete(agentId);
  }
}
