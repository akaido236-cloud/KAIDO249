import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Kaido } from '../src/index.js';
import { MockProvider } from '../src/ai/mock.js';

/**
 * Regression tests for two real bugs found when KAIDO was first run on a
 * phone: a goal containing the word "KAIDO" routed to the Master Agent
 * itself (which holds no tools, so the task could only die), and the failure
 * was completely silent — no error was ever surfaced.
 */

test('the Master Agent is never a routing target', () => {
  const kaido = new Kaido({ dataDir: null, adapters: false });
  kaido.instantiateTemplate('kaido-researcher');

  // "KAIDO" appears in the goal — this is what broke it in the wild.
  const routed = kaido.orchestrator.route('اعمل لي ملخص لشنو يقدر KAIDO يسوي');
  assert.notEqual(routed?.name, 'KAIDO', 'must never route back to the master');
  assert.ok(routed, 'should route to a real child agent');
});

test('a goal matching no specialist does not route to the master', () => {
  const kaido = new Kaido({ dataDir: null, adapters: false });
  kaido.instantiateTemplate('kaido-researcher');
  const routed = kaido.orchestrator.route('zzz qqq unrelated gibberish');
  assert.notEqual(routed?.name, 'KAIDO');
});

test('a failed task surfaces its errors instead of failing silently', async () => {
  // The planning call throws; the run must still report WHY.
  const provider = new MockProvider(() => {
    throw new Error('simulated planner outage');
  });
  const kaido = new Kaido({ dataDir: null, adapters: false, provider });
  kaido.instantiateTemplate('kaido-coder');

  const { outcome } = await kaido.ask('do something that will fail');
  assert.ok(outcome.errors.length > 0, 'errors must be populated on failure');
  assert.ok(
    outcome.errors.some((e) => e.includes('simulated planner outage')),
    'the underlying reason must be preserved',
  );
});

test('the outcome always carries an errors array, even on success', async () => {
  const provider = new MockProvider().enqueue(
    JSON.stringify({ steps: [{ agentName: 'KAIDO RESEARCHER', objective: 'look it up' }] }),
  );
  const kaido = new Kaido({ dataDir: null, adapters: false, provider });
  kaido.instantiateTemplate('kaido-researcher');
  const { outcome } = await kaido.ask('research something');
  assert.ok(Array.isArray(outcome.errors), 'errors must always be an array');
});

// ── Round 2: failures observed on the phone with a live Gemini key ───────────

test('with no child agents installed, the plan says so instead of inventing one', async () => {
  const kaido = new Kaido({ provider: new MockProvider(), dataDir: null, tools: [] });
  const plan = await kaido.ask('اعمل لي ملخص');

  assert.equal(plan.plan.steps.length, 1);
  assert.equal(plan.plan.steps[0]!.status, 'failed');
  assert.match(plan.plan.steps[0]!.objective, /add-all-templates/);

  // And the reason is reported, not swallowed.
  assert.ok(kaido.lastPlannerError, 'expected a planner error to be reported');
  assert.match(kaido.lastPlannerError!, /NO_AGENTS_INSTALLED/);
  const joined = plan.outcome.errors.join(' ');
  assert.match(joined, /NO_AGENTS_INSTALLED/);
});

test('an Arabic goal still routes to an agent once one exists', async () => {
  const kaido = new Kaido({ provider: new MockProvider(), dataDir: null, tools: [] });
  kaido.instantiateTemplate('kaido-researcher');

  const agent = kaido.orchestrator.route('ابحث لي عن معلومات');
  assert.ok(agent, 'expected a fallback agent for a non-English goal');
  assert.notEqual(agent!.name, 'KAIDO');
});

test('a planner error from an earlier run is cleared by a later one', async () => {
  // Call plan() directly: ask() would also invoke the agent, which consumes a
  // queued reply and makes the sequence ambiguous.
  const provider = new MockProvider().enqueue(
    'not json at all',
    JSON.stringify({ steps: [{ agentName: 'KAIDO RESEARCHER', objective: 'ok' }] }),
  );
  const kaido = new Kaido({ provider, dataDir: null, tools: [] });
  kaido.instantiateTemplate('kaido-researcher');

  await kaido.orchestrator.plan('first goal that fails to parse');
  assert.ok(kaido.lastPlannerError, 'expected the first run to record an error');

  await kaido.orchestrator.plan('second goal that parses fine');
  assert.equal(kaido.lastPlannerError, null, 'a later success must clear the old error');
});
