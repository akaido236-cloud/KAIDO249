import { makeId, nowIso } from '../core/ids.js';
import { AutomationAction, Automation, Condition, KaidoEvent } from '../core/types.js';

export type EventHandler = (event: KaidoEvent) => void | Promise<void>;

/**
 * Internal event bus. Adapters (Gmail poller, notification listener, GitHub
 * webhook, scheduler) publish events here; the automation engine subscribes.
 * The bus is the seam that keeps KAIDO event-driven rather than polling.
 */
export class EventBus {
  private handlers = new Map<string, EventHandler[]>();
  private log: KaidoEvent[] = [];

  on(eventType: KaidoEvent['type'] | '*', handler: EventHandler): void {
    const list = this.handlers.get(eventType) ?? [];
    list.push(handler);
    this.handlers.set(eventType, list);
  }

  async publish(event: Omit<KaidoEvent, 'id' | 'timestamp'> & Partial<Pick<KaidoEvent, 'id' | 'timestamp'>>): Promise<KaidoEvent> {
    const full: KaidoEvent = {
      id: event.id ?? makeId('evt'),
      timestamp: event.timestamp ?? nowIso(),
      type: event.type,
      source: event.source,
      payload: event.payload ?? {},
    };
    this.log.push(full);
    if (this.log.length > 1000) this.log = this.log.slice(-500);
    for (const h of [...(this.handlers.get(full.type) ?? []), ...(this.handlers.get('*') ?? [])]) {
      try {
        await h(full);
      } catch {
        /* a failing subscriber must not break the bus */
      }
    }
    return full;
  }

  history(limit = 100): KaidoEvent[] {
    return this.log.slice(-limit);
  }
}

/**
 * The Automation engine: WHEN / IF / THEN rules.
 * Triggers are event subscriptions; conditions are tested against the event
 * payload; actions are delegated to the runtime or emitted as notifications.
 */
export class AutomationEngine {
  private automations = new Map<string, Automation>();

  constructor(
    private readonly bus: EventBus,
    private readonly runActions: (automation: Automation, event: KaidoEvent) => Promise<void>,
  ) {
    this.bus.on('*', (event) => this.handleEvent(event));
  }

  register(input: Omit<Automation, 'id' | 'createdAt' | 'updatedAt' | 'runCount'> & Partial<Pick<Automation, 'id'>>): Automation {
    const automation: Automation = {
      id: input.id ?? makeId('aut'),
      name: input.name,
      enabled: input.enabled ?? true,
      ownerAgentId: input.ownerAgentId,
      trigger: input.trigger,
      conditions: input.conditions ?? [],
      actions: input.actions,
      preAuthorised: input.preAuthorised ?? false,
      runCount: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.automations.set(automation.id, automation);
    return automation;
  }

  setEnabled(id: string, enabled: boolean): void {
    const a = this.automations.get(id);
    if (a) {
      a.enabled = enabled;
      a.updatedAt = nowIso();
    }
  }

  remove(id: string): boolean {
    return this.automations.delete(id);
  }

  list(): Automation[] {
    return [...this.automations.values()];
  }

  private async handleEvent(event: KaidoEvent): Promise<void> {
    for (const automation of this.automations.values()) {
      if (!automation.enabled) continue;
      const trigger = automation.trigger;
      const matchesTrigger =
        'eventType' in trigger && trigger.eventType === event.type;
      if (!matchesTrigger) continue;
      if (!this.conditionsHold(automation.conditions, event)) continue;
      automation.lastRunAt = nowIso();
      automation.runCount += 1;
      await this.runActions(automation, event);
    }
  }

  /** Conditions are evaluated against a flattened view of the event payload. */
  private conditionsHold(conditions: Condition[], event: KaidoEvent): boolean {
    for (const c of conditions) {
      const actual = this.resolve(event, c.field);
      if (!this.test(actual, c.op, c.value)) return false;
    }
    return true;
  }

  private resolve(event: KaidoEvent, path: string): unknown {
    if (path === 'type') return event.type;
    if (path === 'source') return event.source;
    const parts = path.replace(/^payload\./, '').split('.');
    let cur: unknown = event.payload;
    for (const p of parts) {
      if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[p];
      } else {
        return undefined;
      }
    }
    return cur;
  }

  private test(actual: unknown, op: Condition['op'], expected?: unknown): boolean {
    switch (op) {
      case 'eq':
        return actual === expected;
      case 'neq':
        return actual !== expected;
      case 'exists':
        return actual !== undefined && actual !== null;
      case 'contains':
        return typeof actual === 'string' && typeof expected === 'string'
          ? actual.toLowerCase().includes(expected.toLowerCase())
          : Array.isArray(actual)
            ? actual.includes(expected)
            : false;
      case 'matches':
        return typeof actual === 'string' && typeof expected === 'string'
          ? new RegExp(expected, 'i').test(actual)
          : false;
      case 'gt':
        return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
      case 'lt':
        return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
      default:
        return false;
    }
  }
}

export type { Automation, AutomationAction };
