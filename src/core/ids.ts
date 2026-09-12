import { randomUUID } from 'node:crypto';

/** Collision-resistant short id with a readable prefix. */
export function makeId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
