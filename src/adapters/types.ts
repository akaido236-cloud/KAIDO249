/**
 * Adapter layer.
 *
 * Tools declare *what* KAIDO can do; adapters provide the *how* on a specific
 * platform. In phases 1–3 every platform tool returned ADAPTER_NOT_MOUNTED.
 * Phase 4 introduces this layer so a real implementation can be mounted, and
 * so an unmounted one keeps telling the truth instead of pretending.
 */

export type AdapterState = 'MOUNTED' | 'NOT_MOUNTED' | 'UNAVAILABLE';

export type Capability =
  | 'notifications'
  | 'contacts'
  | 'camera'
  | 'files'
  | 'calendar'
  | 'location'
  | 'clipboard'
  | 'shell'
  | 'web';

export type AdapterInfo = {
  id: string;
  label: string;
  capabilities: Capability[];
  state: AdapterState;
  /** Human-readable reason when not MOUNTED. */
  detail?: string;
};

/** Every adapter exposes a probe so callers can report true state. */
export interface Adapter {
  readonly id: string;
  readonly label: string;
  readonly capabilities: Capability[];
  /** Cheap liveness check. Never throws — returns a state instead. */
  probe(): Promise<{ state: AdapterState; detail?: string }>;
}

/**
 * The registry tools consult at call time. A tool asks for a capability and
 * either receives the adapter or a truthful refusal.
 */
export class AdapterRegistry {
  private adapters = new Map<string, Adapter>();

  mount(adapter: Adapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  unmount(id: string): void {
    this.adapters.delete(id);
  }

  get(id: string): Adapter | undefined {
    return this.adapters.get(id);
  }

  /** First mounted adapter offering a capability, if any. */
  forCapability(capability: Capability): Adapter | undefined {
    return [...this.adapters.values()].find((a) => a.capabilities.includes(capability));
  }

  list(): Adapter[] {
    return [...this.adapters.values()];
  }

  async status(): Promise<AdapterInfo[]> {
    const out: AdapterInfo[] = [];
    for (const a of this.adapters.values()) {
      const probe = await a.probe();
      out.push({
        id: a.id,
        label: a.label,
        capabilities: a.capabilities,
        state: probe.state,
        detail: probe.detail,
      });
    }
    return out;
  }
}

/** Result shape shared by every adapter call. */
export type AdapterResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; error: string };

export function notMounted(what: string): AdapterResult<never> {
  return {
    ok: false,
    code: 'ADAPTER_NOT_MOUNTED',
    error: `${what} adapter is not mounted in this runtime.`,
  };
}

export function unavailable(what: string, detail: string): AdapterResult<never> {
  return { ok: false, code: 'ADAPTER_UNAVAILABLE', error: `${what} is unavailable: ${detail}` };
}
