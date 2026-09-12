import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeId, nowIso } from '../core/ids.js';
import { MemoryKind, MemoryRecord, MemoryScope } from '../core/types.js';

const SHARED_NAMESPACE = '__shared__';

export type MemoryWrite = {
  ownerId: string;
  namespace: string;
  kind: MemoryKind;
  key: string;
  value: string;
  basis?: 'user_stated' | 'agent_inferred';
  sensitive?: boolean;
};

/**
 * Memory store with isolation by default.
 *
 * - PRIVATE agents see only their own records.
 * - SHARED agents additionally see the shared namespace.
 * - SELECTIVE agents see only the shared namespaces explicitly listed in
 *   `readableNamespaces`.
 *
 * A read never returns another agent's private memory.
 */
export class MemoryStore {
  private records: MemoryRecord[] = [];
  private readonly file: string | null;

  constructor(dataDir: string | null = null) {
    if (dataDir) {
      mkdirSync(dataDir, { recursive: true });
      this.file = join(dataDir, 'memory.json');
      if (existsSync(this.file)) {
        try {
          this.records = JSON.parse(readFileSync(this.file, 'utf8')) as MemoryRecord[];
        } catch {
          this.records = [];
        }
      }
    } else {
      this.file = null;
    }
  }

  private persist(): void {
    if (this.file) writeFileSync(this.file, JSON.stringify(this.records, null, 2), 'utf8');
  }

  write(input: MemoryWrite): MemoryRecord {
    if (input.sensitive && input.basis !== 'user_stated') {
      throw new Error(
        'Refusing to auto-store a sensitive value inferred by an agent. Sensitive memory requires explicit user entry.',
      );
    }
    const existing = this.records.find(
      (r) =>
        r.ownerId === input.ownerId && r.namespace === input.namespace && r.key === input.key,
    );
    if (existing) {
      existing.value = input.value;
      existing.kind = input.kind;
      existing.updatedAt = nowIso();
      this.persist();
      return existing;
    }
    const record: MemoryRecord = {
      id: makeId('mem'),
      ownerId: input.ownerId,
      namespace: input.namespace,
      kind: input.kind,
      key: input.key,
      value: input.value,
      basis: input.basis ?? 'agent_inferred',
      sensitive: input.sensitive ?? false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.records.push(record);
    this.persist();
    return record;
  }

  remove(id: string): boolean {
    const before = this.records.length;
    this.records = this.records.filter((r) => r.id !== id);
    const changed = this.records.length !== before;
    if (changed) this.persist();
    return changed;
  }

  /** Clear a single agent's memory. Returns the number of records removed. */
  clearAgent(ownerId: string): number {
    const before = this.records.length;
    this.records = this.records.filter((r) => r.ownerId !== ownerId);
    this.persist();
    return before - this.records.length;
  }

  all(): MemoryRecord[] {
    return [...this.records];
  }

  /** Records an agent may read, honouring its memory scope. */
  readable(
    agentId: string,
    scope: MemoryScope,
    readableNamespaces: string[] = [],
    query?: string,
  ): MemoryRecord[] {
    const visible = this.records.filter((r) => {
      if (r.ownerId === agentId) return true;
      if (scope === 'PRIVATE') return false;
      if (scope === 'SHARED') return r.ownerId === SHARED_NAMESPACE;
      if (scope === 'SELECTIVE') {
        return r.ownerId === SHARED_NAMESPACE && readableNamespaces.includes(r.namespace);
      }
      return false;
    });
    if (!query) return visible;
    const q = query.toLowerCase();
    return visible.filter(
      (r) => r.key.toLowerCase().includes(q) || r.value.toLowerCase().includes(q),
    );
  }

  /** Namespaces in the shared store — for the memory-sharing control UI. */
  sharedNamespaces(): string[] {
    return [
      ...new Set(this.records.filter((r) => r.ownerId === SHARED_NAMESPACE).map((r) => r.namespace)),
    ];
  }

  /** Write to the shared, cross-agent namespace. */
  writeShared(input: Omit<MemoryWrite, 'ownerId'>): MemoryRecord {
    return this.write({ ...input, ownerId: SHARED_NAMESPACE });
  }
}

export { SHARED_NAMESPACE };
