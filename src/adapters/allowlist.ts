/**
 * Termux command validation — structured, shell-free.
 *
 * Two properties matter here and both are deliberate:
 *
 *  1. Shell metacharacters are REJECTED, not escaped. Commands are executed
 *     with execFile (no shell), so there is nothing to interpret and no
 *     injection surface. If a command needs a pipe or redirect, it does not
 *     belong on this bridge.
 *  2. The allowlist is structured (program + argument rules), not a regex over
 *     the whole string, so what is permitted is readable and auditable.
 *
 * This module is the single point that decides whether a command may run.
 * It is used by the client AND again by the bridge server — the server never
 * trusts the client's verdict.
 */

export type ParsedCommand = { program: string; args: string[] };

export type Verdict =
  | { allowed: true; reason: string; parsed: ParsedCommand }
  | { allowed: false; reason: string; code: string };

/** Hard-blocked patterns. Checked before anything else. */
const DENYLIST: { pattern: RegExp; label: string }[] = [
  { pattern: /(^|\s)rm\s+(-[a-z]*\s+)*-[a-z]*r[a-z]*f|(^|\s)rm\s+-rf/i, label: 'recursive force delete' },
  { pattern: /\brm\s+-rf\b/i, label: 'recursive force delete' },
  { pattern: /(^|\s|\/)sudo(\s|$)/i, label: 'privilege escalation' },
  { pattern: /\bmkfs\b/i, label: 'filesystem creation' },
  { pattern: /\bdd\s+if=/i, label: 'raw device write' },
  { pattern: />\s*\/dev\/(sd|block|mmcblk)/i, label: 'raw device write' },
  { pattern: /\biptables\b/i, label: 'firewall modification' },
  { pattern: /\b(shutdown|reboot|halt|poweroff)\b/i, label: 'host shutdown' },
  { pattern: /\bchmod\s+(-[a-z]+\s+)*777\s+\//i, label: 'permission corruption at root' },
  { pattern: /\bchown\s+(-[a-z]+\s+)*-R\s+.*\s+\//i, label: 'recursive ownership change at root' },
  { pattern: /:\s*\(\s*\)\s*\{/i, label: 'fork bomb' },
  { pattern: /\bcurl\b[^|]*\|\s*(ba)?sh/i, label: 'remote code execution' },
  { pattern: /\bwget\b[^|]*\|\s*(ba)?sh/i, label: 'remote code execution' },
];

/** Characters that would hand control to a shell. Refused outright. */
const SHELL_METACHARACTERS = /[;|&$`><\n\r\\(){}[\]*?~#!]/;

/**
 * A safe argument. Spaces are permitted because shell metacharacters are
 * already refused before parsing, and quote-aware splitting has removed the
 * quotes — so `-m "fix ci"` correctly arrives here as one argument containing
 * a space. Nothing in this charset can reach a shell.
 */
const SAFE_ARG = /^[\w@./:=+ -]+$/;

/** A rule: a program plus a predicate over its arguments. */
type Rule = {
  program: string;
  /** True when these exact args are permitted. */
  allow: (args: string[]) => boolean;
  description: string;
};

const isSafeArgs = (args: string[]): boolean => args.every((a) => SAFE_ARG.test(a));

const RULES: Rule[] = [
  {
    program: 'npm',
    description: 'npm scripts',
    allow: (a) =>
      (a.length === 2 && a[0] === 'run' && ['build', 'test', 'lint', 'typecheck', 'check', 'start'].includes(a[1]!)) ||
      (a.length === 1 && a[0] === '--version') ||
      (a.length === 1 && a[0] === 'ci') ||
      (a.length === 1 && a[0] === 'install'),
  },
  {
    program: 'npx',
    description: 'npx runners',
    allow: (a) =>
      a.length >= 1 && ['tsc', 'tsx', 'vitest', 'jest'].includes(a[0]!) && isSafeArgs(a.slice(1)),
  },
  {
    program: 'node',
    description: 'node',
    allow: (a) =>
      (a.length === 1 && a[0] === '--version') ||
      (a.length === 1 && /^[\w./-]+\.(mjs|cjs|js)$/.test(a[0]!)),
  },
  {
    program: 'git',
    description: 'git read operations',
    allow: (a) =>
      a.length >= 1 &&
      ['status', 'log', 'diff', 'branch', 'show', 'remote', 'rev-parse'].includes(a[0]!) &&
      isSafeArgs(a.slice(1)),
  },
  {
    program: 'git',
    description: 'git write operations (still confirmation-gated)',
    allow: (a) =>
      a.length >= 2 &&
      ['add', 'commit', 'push', 'pull', 'checkout', 'switch', 'restore'].includes(a[0]!) &&
      isSafeArgs(a.slice(1)),
  },
  {
    program: 'ls',
    description: 'list directory',
    allow: (a) => isSafeArgs(a),
  },
  { program: 'pwd', description: 'print working directory', allow: (a) => a.length === 0 },
  { program: 'cat', description: 'read a file', allow: (a) => a.length === 1 && SAFE_ARG.test(a[0]!) },
  { program: 'echo', description: 'echo', allow: (a) => isSafeArgs(a) },
  {
    program: 'which',
    description: 'locate a binary',
    allow: (a) => a.length === 1 && SAFE_ARG.test(a[0]!),
  },
  {
    program: 'find',
    description: 'find files (read-only, no -exec)',
    allow: (a) => isSafeArgs(a) && !a.includes('-exec') && !a.includes('-delete'),
  },
];

/** Split a command into program + args WITHOUT invoking a shell. */
export function parseCommand(command: string): { ok: true; parsed: ParsedCommand } | { ok: false; reason: string } {
  const trimmed = command.trim();
  if (trimmed.length === 0) return { ok: false, reason: 'Empty command.' };
  if (trimmed.length > 500) return { ok: false, reason: 'Command exceeds 500 characters.' };
  if (SHELL_METACHARACTERS.test(trimmed)) {
    return {
      ok: false,
      reason: 'Command contains shell metacharacters. The bridge runs commands directly, never through a shell.',
    };
  }
  // Quote-aware split for spaces and simple quoted args.
  const parts: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (const ch of trimmed) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ' ') {
      if (current) {
        parts.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (quote) return { ok: false, reason: 'Unterminated quote in command.' };
  if (current) parts.push(current);
  const [program, ...args] = parts;
  if (!program) return { ok: false, reason: 'No program specified.' };
  return { ok: true, parsed: { program, args } };
}

/**
 * The single decision point. Returns a verdict with a reason the user can read.
 * `extraPrograms` lets an embedded deployment widen the allowlist explicitly.
 */
export function validateCommand(command: string, extraPrograms: string[] = []): Verdict {
  const raw = command.trim();
  if (raw.length === 0) {
    return { allowed: false, reason: 'Empty command.', code: 'EMPTY' };
  }
  if (raw.length > 500) {
    return { allowed: false, reason: 'Command exceeds 500 characters.', code: 'TOO_LONG' };
  }

  for (const { pattern, label } of DENYLIST) {
    if (pattern.test(raw)) {
      return {
        allowed: false,
        reason: `Refused: command matches a hard-blocked pattern (${label}).`,
        code: 'DENYLISTED',
      };
    }
  }

  const parsed = parseCommand(raw);
  if (!parsed.ok) {
    return { allowed: false, reason: parsed.reason, code: 'UNPARSEABLE' };
  }

  const { program, args } = parsed.parsed;
  const rules = [
    ...RULES,
    ...extraPrograms.map((p) => ({
      program: p,
      description: 'explicitly added by the user',
      allow: (a: string[]) => isSafeArgs(a),
    })),
  ];
  const matching = rules.filter((r) => r.program === program);
  if (matching.length === 0) {
    return {
      allowed: false,
      reason: `"${program}" is not on the allowlist. Add it explicitly if you trust it — KAIDO never executes arbitrary shell.`,
      code: 'NOT_ALLOWLISTED',
    };
  }
  if (matching.some((r) => r.allow(args))) {
    return { allowed: true, reason: 'Command matches the allowlist.', parsed: parsed.parsed };
  }
  return {
    allowed: false,
    reason: `"${program}" is allowlisted but these arguments are not permitted.`,
    code: 'ARGS_NOT_ALLOWED',
  };
}

/** Backwards-compatible shape used by the tools layer. */
export function validateTermuxCommand(command: string): { allowed: boolean; reason: string } {
  const v = validateCommand(command);
  return { allowed: v.allowed, reason: v.reason };
}
