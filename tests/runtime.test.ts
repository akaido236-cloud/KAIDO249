import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Permission, RiskLevel } from '../src/core/types.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { PermissionManager } from '../src/security/permissions.js';
import { RiskEngine } from '../src/security/risk.js';
import { AuditLog } from '../src/security/audit.js';
import { MemoryStore } from '../src/memory/store.js';
import { AgentRuntime } from '../src/agent/runtime.js';
import { AgentFactory } from '../src/agent/factory.js';
import { WRITE_CONFIRM_POLICY } from '../src/agent/factory.js';

function makeRuntime() {
  const registry = new ToolRegistry();
  const permissions = new PermissionManager();
  const risk = new RiskEngine();
  const audit = new AuditLog(null);
  const memory = new MemoryStore(null);
  const runtime = new AgentRuntime(registry, permissions, risk, audit, memory);

  // A low-risk read tool.
  registry.register({
    id: 'test.read',
    name: 'Read',
    description: 'Reads something.',
    category: 'internal',
    permissions: [Permission.READ_GITHUB],
    riskLevel: RiskLevel.LOW,
    requiresConfirmation: false,
    sideEffect: false,
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ ok: true, data: { value: 42 }, summary: 'read ok' }),
  });

  // A high-risk write tool.
  registry.register({
    id: 'test.write',
    name: 'Write',
    description: 'Writes something external.',
    category: 'github',
    permissions: [Permission.WRITE_GITHUB],
    riskLevel: RiskLevel.HIGH,
    requiresConfirmation: true,
    sideEffect: true,
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ ok: true, data: { written: true }, summary: 'wrote ok' }),
  });

  const factory = new AgentFactory();
  const agent = factory.create({
    name: 'TESTER',
    description: 'test agent',
    systemPrompt: 'You are a test agent used in the KAIDO test suite.',
    tools: ['test.read', 'test.write'],
    permissions: [Permission.READ_GITHUB, Permission.WRITE_GITHUB],
    confirmationPolicy: WRITE_CONFIRM_POLICY,
  });
  permissions.setPermissions(agent.id, agent.permissions);
  return { registry, permissions, risk, audit, memory, runtime, agent, factory };
}

test('a tool the agent was not assigned is denied', async () => {
  const { runtime, agent } = makeRuntime();
  const outcome = await runtime.executeTool(agent, 'gmail.send', {}, 't1');
  assert.equal(outcome.status, 'DENIED');
});

test('a tool whose permission the agent lacks is denied', async () => {
  const { runtime, agent, factory, permissions } = makeRuntime();
  const limited = factory.create({
    name: 'LIMITED',
    description: 'no perms',
    systemPrompt: 'You are a limited test agent with no permissions at all.',
    tools: ['test.read'],
    permissions: [],
  });
  permissions.setPermissions(limited.id, []);
  const outcome = await runtime.executeTool(limited, 'test.read', {}, 't2');
  assert.equal(outcome.status, 'DENIED');
  if (outcome.status === 'DENIED') assert.match(outcome.reason, /Missing permissions/);
  assert.ok(agent.permissions.length > 0);
});

test('low-risk read executes without confirmation', async () => {
  const { runtime, agent } = makeRuntime();
  const outcome = await runtime.executeTool(agent, 'test.read', {}, 't3');
  assert.equal(outcome.status, 'COMPLETED');
  if (outcome.status === 'COMPLETED') assert.equal(outcome.result.ok, true);
});

test('high-risk write is gated behind confirmation, not executed', async () => {
  const { runtime, agent, audit } = makeRuntime();
  const outcome = await runtime.executeTool(agent, 'test.write', { target: 'repo' }, 't4');
  assert.equal(outcome.status, 'REQUIRES_CONFIRMATION');
  if (outcome.status === 'REQUIRES_CONFIRMATION') {
    assert.match(outcome.confirmation.preview, /TESTER/);
  }
  // The tool must NOT have run.
  const invoked = audit.forTask('t4').filter((e) => e.type === 'TOOL_INVOKED');
  assert.equal(invoked.length, 0);
  const requested = audit.forTask('t4').filter((e) => e.type === 'CONFIRMATION_REQUESTED');
  assert.equal(requested.length, 1);
});

test('emergency stop blocks every subsequent action', async () => {
  const { runtime, agent } = makeRuntime();
  runtime.emergencyStop('test');
  const outcome = await runtime.executeTool(agent, 'test.read', {}, 't5');
  assert.equal(outcome.status, 'DENIED');
  if (outcome.status === 'DENIED') assert.match(outcome.reason, /stopped/i);
  runtime.resume();
  const after = await runtime.executeTool(agent, 'test.read', {}, 't6');
  assert.equal(after.status, 'COMPLETED');
});

test('every tool call is audited', async () => {
  const { runtime, agent, audit } = makeRuntime();
  await runtime.executeTool(agent, 'test.read', {}, 't7');
  const types = audit.forTask('t7').map((e) => e.type);
  assert.ok(types.includes('PERMISSION_CHECKED'));
  assert.ok(types.includes('RISK_ASSESSED'));
  assert.ok(types.includes('TOOL_INVOKED'));
  assert.ok(types.includes('TOOL_COMPLETED'));
});
