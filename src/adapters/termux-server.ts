import { execFile } from 'node:child_process';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { validateCommand } from './allowlist.js';

/**
 * The Termux bridge SERVER — a small HTTP endpoint that runs inside Termux on
 * the phone and executes validated commands on KAIDO's behalf.
 *
 * Why a separate process: KAIDO's agent runtime may run anywhere (the cloud,
 * the Android app, another machine), but the commands must run on the phone.
 * The bridge is the narrow, auditable door between them.
 *
 * Security posture:
 *   - Binds to 127.0.0.1 by default. Exposing it to a network is opt-in and
 *     should be paired with the shared-secret check below.
 *   - RE-VALIDATES every command server-side. It never trusts the caller's
 *     verdict, because the caller could be compromised or simply wrong.
 *   - Runs with execFile (no shell), so there is no shell to inject into.
 *   - Scopes execution to a root directory and enforces a timeout and an
 *     output cap.
 */

export type BridgeOptions = {
  port?: number;
  host?: string;
  /** Directory commands run in. Required — there is no implicit cwd. */
  root: string;
  /** Shared secret. When set, every request must present it. */
  token?: string;
  /** Per-command wall-clock limit. */
  timeoutMs?: number;
  /** Cap on captured stdout+stderr returned to the caller. */
  maxOutputBytes?: number;
  /** Extra allowed programs, added explicitly by the user. */
  extraPrograms?: string[];
};

export type BridgeResult = {
  command: string;
  program: string;
  args: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  durationMs: number;
  /** Output is UNTRUSTED — the caller must wrap it before a model reads it. */
  untrusted: true;
};

export class TermuxBridge {
  private server: Server | null = null;
  private readonly opts: Required<Omit<BridgeOptions, 'token' | 'extraPrograms'>> & {
    token?: string;
    extraPrograms: string[];
  };

  constructor(options: BridgeOptions) {
    this.opts = {
      port: options.port ?? 7077,
      host: options.host ?? '127.0.0.1',
      root: options.root,
      token: options.token,
      timeoutMs: options.timeoutMs ?? 60_000,
      maxOutputBytes: options.maxOutputBytes ?? 200_000,
      extraPrograms: options.extraPrograms ?? [],
    };
  }

  async start(): Promise<{ host: string; port: number }> {
    const server = createServer((req, res) => this.handle(req, res));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.opts.port, this.opts.host, () => resolve());
    });
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : this.opts.port;
    return { host: this.opts.host, port };
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = null;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const json = (code: number, body: unknown): void => {
      const payload = JSON.stringify(body);
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(payload);
    };

    if (req.method === 'GET' && req.url === '/health') {
      json(200, { ok: true, service: 'kaido-termux-bridge', root: this.opts.root });
      return;
    }

    if (req.method !== 'POST' || req.url !== '/exec') {
      json(404, { ok: false, code: 'NOT_FOUND', error: 'Use POST /exec.' });
      return;
    }

    if (this.opts.token) {
      const presented = req.headers['x-kaido-token'];
      if (presented !== this.opts.token) {
        json(401, { ok: false, code: 'UNAUTHORIZED', error: 'Missing or incorrect bridge token.' });
        return;
      }
    }

    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 10_000) {
        json(413, { ok: false, code: 'BODY_TOO_LARGE', error: 'Request body too large.' });
        return;
      }
    }

    let command: unknown;
    try {
      command = (JSON.parse(body) as { command?: unknown }).command;
    } catch {
      json(400, { ok: false, code: 'BAD_JSON', error: 'Request body must be JSON.' });
      return;
    }
    if (typeof command !== 'string') {
      json(400, { ok: false, code: 'BAD_REQUEST', error: 'Expected { "command": string }.' });
      return;
    }

    // Server-side re-validation. The caller's verdict is never trusted.
    const verdict = validateCommand(command, this.opts.extraPrograms);
    if (!verdict.allowed) {
      json(403, { ok: false, code: verdict.code, error: verdict.reason });
      return;
    }

    const result = await this.run(verdict.parsed.program, verdict.parsed.args, command);
    json(200, { ok: true, result });
  }

  /** Execute without a shell. */
  private run(program: string, args: string[], original: string): Promise<BridgeResult & { command: string }> {
    const started = Date.now();
    return new Promise((resolve) => {
      const child = execFile(
        program,
        args,
        {
          cwd: this.opts.root,
          timeout: this.opts.timeoutMs,
          maxBuffer: this.opts.maxOutputBytes,
          shell: false, // explicit: never a shell
          env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
        },
        (error, stdout, stderr) => {
          const truncated =
            typeof stdout === 'string' && stdout.length >= this.opts.maxOutputBytes;
          const exitCode =
            error && typeof (error as { code?: unknown }).code === 'number'
              ? ((error as { code: number }).code)
              : error
                ? 1
                : 0;
          resolve({
            command: original,
            program,
            args,
            exitCode,
            stdout: String(stdout).slice(0, this.opts.maxOutputBytes),
            stderr: String(stderr).slice(0, this.opts.maxOutputBytes),
            truncated,
            durationMs: Date.now() - started,
            untrusted: true,
          });
        },
      );
      void child;
    });
  }
}
