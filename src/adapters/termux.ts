import { execFile } from 'node:child_process';
import { Adapter, AdapterResult, Capability } from './types.js';
import { BridgeResult } from './termux-server.js';
import { validateCommand } from './allowlist.js';

/**
 * Termux bridge CLIENT — used by the agent runtime to reach the phone.
 *
 * Two modes:
 *   - 'http': talk to a running bridge server (the normal case; the phone may
 *     be a different device from the runtime).
 *   - 'local': execute directly in this process. Only makes sense when the
 *     runtime already runs inside Termux.
 *
 * In BOTH modes the command is validated first with the same allowlist the
 * server uses, so a misconfigured or rogue endpoint cannot widen what KAIDO
 * will attempt.
 */

export type TermuxMode = 'http' | 'local';

export type TermuxClientOptions = {
  mode?: TermuxMode;
  baseUrl?: string;
  token?: string;
  /** Root for 'local' mode. */
  root?: string;
  timeoutMs?: number;
  extraPrograms?: string[];
};

export class TermuxAdapter implements Adapter {
  readonly id = 'termux';
  readonly label = 'Termux bridge';
  readonly capabilities: Capability[] = ['shell'];
  private readonly mode: TermuxMode;
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly root: string;
  private readonly timeoutMs: number;
  private readonly extraPrograms: string[];

  constructor(options: TermuxClientOptions = {}) {
    this.mode = options.mode ?? (process.env.KAIDO_TERMUX_ENABLED === 'true' ? 'local' : 'http');
    this.baseUrl = options.baseUrl ?? process.env.KAIDO_TERMUX_BRIDGE_URL ?? 'http://127.0.0.1:7077';
    this.token = options.token ?? process.env.KAIDO_TERMUX_BRIDGE_TOKEN;
    this.root = options.root ?? process.env.KAIDO_TERMUX_PROJECT_ROOT ?? process.cwd();
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.extraPrograms = options.extraPrograms ?? [];
  }

  async probe(): Promise<{ state: 'MOUNTED' | 'NOT_MOUNTED' | 'UNAVAILABLE'; detail?: string }> {
    if (process.env.KAIDO_TERMUX_ENABLED !== 'true') {
      return {
        state: 'NOT_MOUNTED',
        detail: 'Set KAIDO_TERMUX_ENABLED=true to arm the Termux bridge.',
      };
    }
    if (this.mode === 'http') {
      try {
        const res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
        if (!res.ok) {
          return { state: 'UNAVAILABLE', detail: `Bridge responded ${res.status}.` };
        }
        return { state: 'MOUNTED', detail: `Bridge at ${this.baseUrl}` };
      } catch (err) {
        return {
          state: 'UNAVAILABLE',
          detail: `Cannot reach the bridge at ${this.baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }
    return { state: 'MOUNTED', detail: `Local execution in ${this.root}` };
  }

  /**
   * Validate, then execute. Returns the output flagged as untrusted so the
   * tool layer wraps it before any model reads it.
   */
  async execute(command: string): Promise<AdapterResult<BridgeResult>> {
    if (process.env.KAIDO_TERMUX_ENABLED !== 'true') {
      return {
        ok: false,
        code: 'TERMUX_DISABLED',
        error: 'The Termux bridge is disabled. Set KAIDO_TERMUX_ENABLED=true to arm it.',
      };
    }
    const verdict = validateCommand(command, this.extraPrograms);
    if (!verdict.allowed) {
      return { ok: false, code: verdict.code, error: verdict.reason };
    }
    return this.mode === 'http' ? this.execHttp(command) : this.execLocal(verdict.parsed);
  }

  private async execHttp(command: string): Promise<AdapterResult<BridgeResult>> {
    try {
      const res = await fetch(`${this.baseUrl}/exec`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.token ? { 'x-kaido-token': this.token } : {}),
        },
        body: JSON.stringify({ command }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const json = (await res.json()) as
        | { ok: true; result: BridgeResult }
        | { ok: false; code: string; error: string };
      if (!json.ok) return { ok: false, code: json.code, error: json.error };
      return { ok: true, data: json.result };
    } catch (err) {
      return {
        ok: false,
        code: 'BRIDGE_UNREACHABLE',
        error: `Could not reach the Termux bridge at ${this.baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private execLocal(parsed: { program: string; args: string[] }): Promise<AdapterResult<BridgeResult>> {
    const started = Date.now();
    return new Promise((resolve) => {
      execFile(
        parsed.program,
        parsed.args,
        {
          cwd: this.root,
          timeout: this.timeoutMs,
          maxBuffer: 200_000,
          shell: false,
          env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
        },
        (error, stdout, stderr) => {
          resolve({
            ok: true,
            data: {
              command: `${parsed.program} ${parsed.args.join(' ')}`.trim(),
              program: parsed.program,
              args: parsed.args,
              exitCode: error && typeof (error as { code?: unknown }).code === 'number'
                ? (error as { code: number }).code
                : error
                  ? 1
                  : 0,
              stdout: String(stdout),
              stderr: String(stderr),
              truncated: false,
              durationMs: Date.now() - started,
              untrusted: true,
            },
          });
        },
      );
    });
  }
}
