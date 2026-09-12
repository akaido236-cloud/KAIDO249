import { Kaido } from '../dist/index.js';
import { MockProvider } from '../dist/ai/mock.js';

// Script the mock provider: first a plan, then a tool call to a HIGH-risk tool.
const provider = new MockProvider().enqueue(
  JSON.stringify({ steps: [{ agentName: 'KAIDO CODER', objective: 'create a GitHub issue' }] }),
  JSON.stringify({
    summary: 'I will create the issue.',
    toolCalls: [{ tool: 'github.createIssue', input: { repo: 'oiu/app', title: 'Fix CI' } }],
  }),
);
const kaido = new Kaido({ provider, dataDir: null });
kaido.instantiateTemplate('kaido-coder');

const { plan, outcome } = await kaido.ask('create a github issue for the CI failure');
console.log('PLAN:', plan.steps.map((s) => `${s.agentName}: ${s.objective} [${s.status}]`).join(' | '));
console.log('STATUS:', outcome.results[0].status);
console.log('REQUIRES USER ACTION:', outcome.requiresUserAction);
for (const p of outcome.pendingConfirmations) console.log('APPROVAL NEEDED:', p.preview);

const invoked = kaido.audit.all().filter((e) => e.type === 'TOOL_INVOKED');
console.log('TOOL ACTUALLY INVOKED (must be 0):', invoked.length);

kaido.stop();
console.log('AFTER STOP:', JSON.stringify(kaido.status()));
