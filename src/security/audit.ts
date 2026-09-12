import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeId, nowIso } from '../core/ids.js';
import { AuditEntry, AuditEventType, RiskLevel, Permission } from '../core/types.js';

/**
 * Append-only audit log. Records agent, task, tool, permission decision,
 * risk, action and result. Detail strings are size-capped and must be
 * redacted by the caller — never log raw secrets or bulk private data.
 */
export class AuditLog {
  private entries: AuditEntry[] = [];
  private readonly file: string | null;

  constructor(dataDir: string | null = null) {
    if (dataDir) {
      mkdirSync(dataDir, { recursive: true });
      this.file = join(dataDir, 'audit.log.jsonl');
      if (existsSync(this.file)) {
        for (const line of readFileSync(this.file, 'utf8').split('\n')) {
          if (!line.trim()) continue;
          try {
            this.entries.push(JSON.parse(line) as AuditEntry);
          } catch {
            /* skip a corrupt line rather than fail the whole log */
          }
        }
      }
    } else {
      this.file = null;
    }
  }

  record(entry: {
    type: AuditEventType;
    agentId: string;
    taskId?: string;
    tool?: string;
    permission?: Permission;
    decision?: string;
    risk?: RiskLevel;
    detail?: string;
    error?: string;
  }): AuditEntry {
    const full: AuditEntry = {
      id: makeId('aud'),
      timestamp: nowIso(),
      ...entry,
      detail: entry.detail ? entry.detail.slice(0, 2000) : undefined,
    };
    this.entries.push(full);
    if (this.file) {
      appendFileSync(this.file, JSON.stringify(full) + '\n', 'utf8');
    }
    return full;
  }

  all(): AuditEntry[] {
    return [...this.entries];
  }

  forAgent(agentId: string, limit = 100): AuditEntry[] {
    return this.entries.filter((e) => e.agentId === agentId).slice(-limit);
  }

  forTask(taskId: string): AuditEntry[] {
    return this.entries.filter((e) => e.taskId === taskId);
  }

  recent(limit = 50): AuditEntry[] {
    return this.entries.slice(-limit);
  }
}
