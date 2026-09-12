#!/usr/bin/env node
/**
 * KAIDO Termux bridge — a standalone server you run inside Termux on the phone.
 *
 *   node dist/bridge.js --root ~/projects
 *   node dist/bridge.js --root ~/projects --port 7077 --token <secret>
 *
 * It exposes POST /exec, re-validates every command against the allowlist,
 * and runs it with execFile (no shell). GET /health reports it is alive.
 *
 * Run this in a Termux session (optionally under `termux-wake-lock`), then
 * set KAIDO_TERMUX_BRIDGE_URL in the environment where KAIDO's agents run.
 */
import { existsSync, realpathSync } from 'node:fs';
import { TermuxBridge } from './adapters/termux-server.js';

type Args = {
  root?: string;
  port: number;
  host: string;
  token?: string;
  extra: string[];
};

function parseArgs(argv: string[]): Args {
  const args: Args = { port: 7077, host: '127.0.0.1', extra: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--root':
      case '-r':
        args.root = next;
        i++;
        break;
      case '--port':
      case '-p':
        args.port = Number(next);
        i++;
        break;
      case '--host':
        args.host = next ?? '127.0.0.1';
        i++;
        break;
      case '--token':
        args.token = next;
        i++;
        break;
      case '--allow':
        if (next) args.extra.push(next);
        i++;
        break;
      default:
        break;
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.root) {
    console.error('Error: --root is required. The bridge never executes without a scoped directory.');
    console.error('Usage: node dist/bridge.js --root ~/projects [--port 7077] [--token SECRET] [--host 127.0.0.1]');
    process.exitCode = 1;
    return;
  }
  if (!existsSync(args.root)) {
    console.error(`Error: root directory does not exist: ${args.root}`);
    process.exitCode = 1;
    return;
  }
  const root = realpathSync(args.root);

  const bridge = new TermuxBridge({
    root,
    port: args.port,
    host: args.host,
    token: args.token,
    extraPrograms: args.extra,
  });

  const { host, port } = await bridge.start();

  console.log('KAIDO Termux bridge');
  console.log(`  listening : http://${host}:${port}`);
  console.log(`  root      : ${root}`);
  console.log(`  auth      : ${args.token ? 'shared token required' : 'NONE (localhost only)'}`);
  console.log(`  extra allow: ${args.extra.length ? args.extra.join(', ') : '(none)'}`);
  console.log('');
  console.log('Every command is re-validated server-side and run without a shell.');
  console.log('Press Ctrl+C to stop.');

  const shutdown = async (): Promise<void> => {
    console.log('\nStopping bridge…');
    await bridge.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
