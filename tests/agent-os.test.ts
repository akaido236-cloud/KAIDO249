import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kaido } from '../src/index.js';
import { MockProvider } from '../src/ai/mock.js';
import { Permission, RiskLevel } from '../src/core/types.js';
import { AgentFactory, WRITE_CONFIRM_POLICY } from '../src/agent/factory.js';
import { EventBus, AutomationEngine } from '../src/automation/engine.js';
import type { KaidoEvent } from '../src/core/types.js';

// ── Agent factory & versioning ──────────────────────────────────────────────

test('agents are pure configuration created by the factory', () => {
  const factory = new AgentFactory();
  const agent = factory.create({
    name: 'KAIDO CODER',
    description: 'code agent',
    systemPrompt: 'You are a coding agent. Stay within your tools.',
    tools: ['github.repositories', 'github.repositories'],
    permissions: [Permission.READ_GITHUB],
  });
  assert.equal(agent.version, 1);
  assert.equal(agent.tools.length, 1, 'duplicate tools are collapsed');
  assert.equal(agent.memoryScope, 'PRIVATE', 'memory is private by default');
  assert.equal(agent.childAgentIds.length, 0);
});

test('a meaningful edit bumps the version; a cosmetic one does not', () => {
  const factory = new AgentFactory();
  const agent = factory.create({
    name: 'Agent One', description: 'd', systemPrompt: 'You are a sufficiently long test prompt.',
    tools: [], permissions: [],
  });
  const v2 = factory.revise(agent, { tools: ['web.search'] });
  assert.equal(v2.version, 2);
  const v2b = factory.revise(v2, { description: 'new description' });
  assert.equal(v2b.version, 2, 'description alone does not bump the version');
});

test('cloning mints a new id and drops automations', () => {
  const factory = new AgentFactory();
  const agent = factory.create({
    name: 'Agent One', description: 'd', systemPrompt: 'You are a sufficiently long test prompt.',
    tools: ['web.search'], permissions: [],
  });
  agent.automationIds.push('aut_1');
  const clone = factory.clone(agent, { name: 'Agent Two' });
  assert.notEqual(clone.id, agent.id);
  assert.equal(clone.name, 'Agent Two');
  assert.deepEqual(clone.automationIds, []);
});

test('a weak spec is rejected', () => {
  const factory = new AgentFactory();
  assert.throws(
    () => factory.create({ name: 'Agent X', description: 'd', systemPrompt: 'short', tools: [], permissions: [] }),
    /systemPrompt/,
  );
});

// ── Full system wiring ──────────────────────────────────────────────────────

test('booting KAIDO creates the master agent with no tools of its own', () => {
  const kaido = new Kaido({ provider: new MockProvider() });
  assert.equal(kaido.master.name, 'KAIDO');
  assert.equal(kaido.master.tools.length, 0, 'the master delegates; it does not hold tools');
  assert.equal(kaido.registry.children(kaido.master.id).length, 0);
});

test('templates instantiate as children of the master', () => {
  const kaido = new Kaido({ provider: new MockProvider() });
  const coder = kaido.instantiateTemplate('kaido-coder');
  assert.equal(coder.parentAgentId, kaido.master.id);
  assert.equal(kaido.registry.children(kaido.master.id).length, 1);
  // Instantiation is idempotent.
  const again = kaido.instantiateTemplate('kaido-coder');
  assert.equal(again.id, coder.id);
});

test('the master routes a goal to the right specialist', () => {
  const kaido = new Kaido({ provider: new MockProvider() });
  kaido.instantiateAllTemplates();
  const coder = kaido.orchestrator.route('fix the bug in my repository and run the tests');
  const devops = kaido.orchestrator.route('why did my deployment pipeline fail');
  assert.equal(coder?.name, 'KAIDO CODER');
  assert.equal(devops?.name, 'KAIDO DEVOPS');
});

test('end-to-end: master plans, delegates to a child, and reports', async () => {
  const provider = new MockProvider().enqueue(
    JSON.stringify({ steps: [{ agentName: 'KAIDO CODER', objective: 'check the latest build' }] }),
    JSON.stringify({ summary: 'Checked CI: the latest build passed.', toolCalls: [] }),
  );
  const kaido = new Kaido({ provider });
  kaido.instantiateTemplate('kaido-coder');

  const { plan, outcome } = await kaido.ask('check my latest build');
  assert.equal(plan.steps.length, 1);
  assert.equal(outcome.results[0]!.status, 'SUCCESS');
  assert.match(outcome.summary, /build passed/);

  const audited = kaido.audit.all().map((e) => e.type);
  assert.ok(audited.includes('AGENT_DELEGATED'));
  assert.ok(audited.includes('AGENT_RESULT'));
});

test('a child agent may not invoke a tool it was not granted', async () => {
  const provider = new MockProvider().enqueue(
    JSON.stringify({ steps: [{ agentName: 'KAIDO CODER', objective: 'send an email' }] }),
    JSON.stringify({ summary: 'sending', toolCalls: [{ tool: 'gmail.send', input: { to: 'x' } }] }),
  );
  const kaido = new Kaido({ provider });
  kaido.instantiateTemplate('kaido-coder');
  const { outcome } = await kaido.ask('send an email for me');
  const errors = outcome.results[0]!.errors ?? [];
  assert.ok(
    errors.some((e) => e.startsWith('REFUSED_TOOL')),
    'the coder must not be able to use Gmail tools it was never assigned',
  );
});

// ── Natural-language agent creation ─────────────────────────────────────────

test('natural-language creation proposes rather than creates, and filters unsafe input', async () => {
  const provider = new MockProvider().enqueue(
    JSON.stringify({
      name: 'KAIDO OIU CODER',
      description: 'Programming assistant for the OIU project.',
      systemPrompt: 'You help program the OIU project. Ask before pushing changes.',
      tools: ['github.repositories', 'termux.execute', 'evil.made.up.tool'],
      permissions: ['READ_GITHUB', 'SUPERUSER_ALL'],
      memoryScope: 'PRIVATE',
    }),
  );
  const kaido = new Kaido({ provider });
  const before = kaido.registry.list().length;
  const proposal = await kaido.creator.propose('Create an agent called KAIDO OIU CODER.');

  assert.equal(kaido.registry.list().length, before, 'nothing is created before approval');
  assert.deepEqual(proposal.spec.tools, ['github.repositories', 'termux.execute'], 'unknown tools are dropped');
  assert.deepEqual(proposal.spec.permissions, [Permission.READ_GITHUB], 'unknown permissions are dropped');
  assert.ok(proposal.spec.confirmationPolicy!.requireConfirmationFor.includes(RiskLevel.HIGH));

  const created = kaido.creator.approve(proposal);
  assert.equal(kaido.registry.list().length, before + 1);
  assert.equal(created.name, 'KAIDO OIU CODER');
});

// ── Automations ─────────────────────────────────────────────────────────────

test('an automation fires only when its trigger and conditions match', async () => {
  const bus = new EventBus();
  const fired: string[] = [];
  const engine = new AutomationEngine(bus, async (a) => {
    fired.push(a.name);
  });

  engine.register({
    name: 'urgent-message-watch',
    ownerAgentId: 'agent_1',
    trigger: { eventType: 'NOTIFICATION_RECEIVED' },
    conditions: [{ field: 'payload.text', op: 'contains', value: 'urgent' }],
    actions: [{ kind: 'notify', message: 'urgent message detected' }],
    preAuthorised: false,
  });

  await bus.publish({ type: 'NOTIFICATION_RECEIVED', source: 'android', payload: { text: 'lunch?' } });
  assert.equal(fired.length, 0, 'a non-matching payload must not fire the rule');

  await bus.publish({ type: 'NOTIFICATION_RECEIVED', source: 'android', payload: { text: 'URGENT: server down' } });
  assert.deepEqual(fired, ['urgent-message-watch']);
});

test('a paused automation does not run', async () => {
  const bus = new EventBus();
  let runs = 0;
  const engine = new AutomationEngine(bus, async () => {
    runs += 1;
  });
  const a = engine.register({
    name: 'x', ownerAgentId: 'a', trigger: { eventType: 'MANUAL' }, conditions: [],
    actions: [], preAuthorised: false,
  });
  engine.setEnabled(a.id, false);
  await bus.publish({ type: 'MANUAL', source: 'cli', payload: {} });
  assert.equal(runs, 0);
});

// ── Integrations report honestly ────────────────────────────────────────────

test('unconfigured integrations report unavailable rather than fabricating a result', async () => {
  const kaido = new Kaido({ provider: new MockProvider() });
  const coder = kaido.instantiateTemplate('kaido-coder');
  const outcome = await kaido.runtime.executeTool(coder, 'github.repositories', {}, 't_int');
  assert.equal(outcome.status, 'COMPLETED');
  if (outcome.status === 'COMPLETED') {
    assert.equal(outcome.result.ok, false);
    if (!outcome.result.ok) assert.equal(outcome.result.code, 'INTEGRATION_UNAVAILABLE');
  }
});

test('a tool not assigned to the agent is refused at the runtime', async () => {
  const kaido = new Kaido({ provider: new MockProvider() });
  const researcher = kaido.instantiateTemplate('kaido-researcher');
  const outcome = await kaido.runtime.executeTool(researcher, 'termux.execute', { command: 'npm run build' }, 't_p');
  assert.equal(outcome.status, 'DENIED');
});

test('emergency stop halts the whole system', async () => {
  const kaido = new Kaido({ provider: new MockProvider() });
  kaido.instantiateTemplate('kaido-coder');
  kaido.stop();
  assert.equal(kaido.status().emergencyStopped, true);
  const blocked = await kaido.askAgent('KAIDO CODER', 'do something');
  assert.ok(blocked.status === 'FAILED' || blocked.status === 'REQUIRES_CONFIRMATION');
  kaido.resume();
  assert.equal(kaido.status().emergencyStopped, false);
});

void ({} as KaidoEvent);
void WRITE_CONFIRM_POLICY;
