#!/usr/bin/env node
/**
 * KAIDO CLI — the headless interface to the agent OS.
 *
 * Usage:
 *   kaido status                      show runtime + agent status
 *   kaido agents                      list agents
 *   kaido templates                   list built-in agent templates
 *   kaido add-template <id>           instantiate a template as a child agent
 *   kaido ask "<goal>"                Master Agent plans, delegates, reports
 *   kaido <agent name> "<objective>"  direct agent task
 *   kaido create-agent "<desc>"       propose an agent from natural language
 *   kaido tools                       list the tool registry
 *   kaido activity [agentId]          show recent audit entries
 *   kaido confirm <id> --approve|--deny
 *   kaido automations                 list automations
 *   kaido stop | resume               emergency stop / resume
 */
import { Kaido } from './index.js';
import { Permission } from './core/types.js';
import { TEMPLATES as TEMPLATE_LIST } from './agent/templates.js';
import { validateTermuxCommand } from './tools/builtin.js';
import { DEFAULT_MODEL } from './agent/factory.js';

const args = process.argv.slice(2);
const dataDir = process.env.KAIDO_DATA_DIR ?? null;

function line(s = ''): void {
  console.log(s);
}

async function main(): Promise<void> {
  const kaido = new Kaido({
    dataDir: dataDir === 'null' ? null : dataDir,
    adapters: process.env.KAIDO_ADAPTERS === 'true',
    projectRoot: process.env.KAIDO_TERMUX_PROJECT_ROOT ?? process.cwd(),
  });
  const cmd = args[0];

  switch (cmd) {
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      line(HELP);
      break;

    case 'status': {
      const s = kaido.status();
      line(`KAIDO ${s.emergencyStopped ? 'STOPPED' : 'running'}`);
      line(`  agents:              ${s.agents}`);
      line(`  active tasks:        ${s.activeTasks}`);
      line(`  pending approvals:   ${s.pendingConfirmations}`);
      line(`  AI provider:         ${kaido.provider.id} (${kaido.provider.isConfigured() ? 'configured' : 'not configured — using mock/offline'})`);
      line(`  tools registered:    ${kaido.tools.list().length}`);
      break;
    }

    case 'agents': {
      const agents = kaido.registry.list();
      if (agents.length === 0) line('No agents yet. Add one with: kaido add-template kaido-coder');
      for (const a of agents) {
        const role = a.parentAgentId ? 'child' : 'master';
        line(`${a.name}  [${role}] ${a.enabled ? 'active' : 'disabled'}  v${a.version}`);
        line(`  ${a.description}`);
        line(`  tools: ${a.tools.length === 0 ? '(none)' : a.tools.join(', ')}`);
        line(`  permissions: ${a.permissions.length === 0 ? '(none)' : a.permissions.join(', ')}`);
        line(`  memory: ${a.memoryScope}   children: ${a.childAgentIds.length}`);
      }
      break;
    }

    case 'templates': {
      for (const t of TEMPLATE_LIST) {
        line(`${t.id.padEnd(18)} ${t.label.padEnd(20)} ${t.category}`);
        line(`  ${t.spec.description}`);
      }
      break;
    }

    case 'add-template': {
      const id = args[1];
      if (!id) throw new Error('Usage: kaido add-template <id>');
      const agent = kaido.instantiateTemplate(id);
      line(`Created ${agent.name} (${agent.id}) as a child of ${kaido.master.name}.`);
      break;
    }

    case 'add-all-templates': {
      const agents = kaido.instantiateAllTemplates();
      line(`Instantiated ${agents.length} agents.`);
      break;
    }

    case 'tools': {
      for (const t of kaido.tools.list()) {
        const avail = t.isAvailable ? (t.isAvailable() ? 'available' : 'not configured') : 'available';
        line(`${t.id.padEnd(24)} ${String(t.riskLevel).padEnd(9)} ${avail.padEnd(16)} ${t.description}`);
      }
      break;
    }

    case 'ask': {
      const goal = args.slice(1).join(' ');
      if (!goal) throw new Error('Usage: kaido ask "<goal>"');
      const { plan, outcome } = await kaido.ask(goal);
      line(`Plan ${plan.id}: ${plan.goal}`);
      for (const s of plan.steps) line(`  ${s.step}. ${s.agentName} → ${s.objective}  [${s.status}]`);
      line('');
      line(outcome.summary || '(no summary)');
      if (outcome.actionsPerformed.length) line(`Actions: ${outcome.actionsPerformed.join(', ')}`);

      // Errors are ALWAYS shown. A silent failure is the worst possible
      // outcome: the user cannot tell a missing key from a bad model name
      // from a genuine bug.
      if (outcome.errors && outcome.errors.length) {
        line('');
        line('WHAT WENT WRONG');
        for (const e of outcome.errors) line(`  - ${e}`);
      }
      if (kaido.lastPlannerError) {
        line('');
        line('PLANNER ERROR (the model call that failed)');
        line(`  ${kaido.lastPlannerError}`);
        line('');
        line('  Most common causes:');
        line('    - GEMINI_API_KEY missing or not exported in this shell');
        line('    - the model name does not exist');
        line('    - no network, or the key has no access to that model');
        line('  Run:  kaido doctor');
      }
      if (outcome.requiresUserAction) {
        line('');
        line('ACTION REQUIRES APPROVAL');
        for (const p of outcome.pendingConfirmations) line(`  [${p.id}] ${p.preview}`);
        line('Approve with: kaido confirm <id> --approve');
      }
      break;
    }

    case 'doctor': {
      line('KAIDO diagnostics');
      line('');
      const providerId = (process.env.KAIDO_AI_PROVIDER ?? 'gemini').toLowerCase();
      line(`  provider selected : ${providerId}`);
      line(`  provider label    : ${kaido.provider.label}`);
      line(`  configured        : ${kaido.provider.isConfigured() ? 'yes' : 'NO'}`);

      if (providerId === 'gemini') {
        const key = process.env.GEMINI_API_KEY ?? '';
        line(`  GEMINI_API_KEY    : ${key ? `set (${key.length} chars, starts "${key.slice(0, 4)}…")` : 'NOT SET'}`);
      }
      line(`  default model     : ${process.env.KAIDO_DEFAULT_MODEL ?? '(built-in default)'}`);
      line('');

      if (!kaido.provider.isConfigured()) {
        line('RESULT: the provider has no credentials, so any task will fail.');
        line('  Fix: put GEMINI_API_KEY=... in .env, then run:');
        line('       set -a; source .env; set +a');
        break;
      }

      line('Testing a real call to the model...');
      try {
        const res = await kaido.provider.chat(
          [{ role: 'user', content: 'Reply with exactly: OK' }],
          { model: DEFAULT_MODEL, maxTokens: 16 },
        );
        const reply = (res.content ?? '').trim();
        line(`  model replied    : "${reply.slice(0, 60)}"`);
        line(`  provider         : ${res.provider}`);
        line('');
        line('RESULT: the model is reachable and answering. Your setup is good.');
        const nonsense = !/ok/i.test(reply);
        if (nonsense) {
          line('  (The reply did not contain "OK", but the call succeeded, so the');
          line('   key and model are working.)');
        }
      } catch (err) {
        line(`  FAILED: ${err instanceof Error ? err.message : String(err)}`);
        line('');
        line('RESULT: the key is present but the call failed. Read the message above:');
        line('  - 400 / API_KEY_INVALID  → the key is wrong or truncated');
        line('  - 403                    → the key is not enabled for this API');
        line('  - 404                    → the model name does not exist');
        line('  - fetch failed           → no network from this device');
      }
      break;
    }

    case 'create-agent': {
      const desc = args.slice(1).join(' ');
      if (!desc) throw new Error('Usage: kaido create-agent "<description>"');
      const proposal = await kaido.creator.propose(desc, kaido.master.id);
      line('AGENT CONFIGURATION (proposed — not yet created)');
      line(`  Name:          ${proposal.review.name}`);
      line(`  Purpose:       ${proposal.review.purpose}`);
      line(`  Tools:         ${proposal.review.tools.join(', ') || '(none)'}`);
      line(`  Permissions:   ${proposal.review.permissions.join(', ') || '(none)'}`);
      line(`  Confirmation:  ${proposal.review.requiresConfirmation.join(', ')}`);
      line(`  Memory:        ${proposal.review.memory}`);
      line('');
      line('Nothing has been created. Review the configuration, then approve.');
      break;
    }

    case 'activity': {
      const agentId = args[1];
      const entries = agentId ? kaido.audit.forAgent(agentId, 40) : kaido.audit.recent(40);
      for (const e of entries) {
        line(`${e.timestamp}  ${e.type.padEnd(22)} ${e.decision ?? ''}  ${e.detail ?? ''}`.trimEnd());
      }
      break;
    }

    case 'automations': {
      const list = kaido.automations.list();
      if (list.length === 0) line('No automations registered.');
      for (const a of list) {
        line(`${a.name}  ${a.enabled ? 'enabled' : 'paused'}  runs: ${a.runCount}`);
      }
      break;
    }

    case 'permissions': {
      // Demonstrate the granular permission catalogue and Termux validation.
      for (const p of Object.values(Permission)) line(p);
      break;
    }

    case 'validate-command': {
      const command = args.slice(1).join(' ');
      const verdict = validateTermuxCommand(command);
      line(verdict.allowed ? `ALLOWED — ${verdict.reason}` : `REFUSED — ${verdict.reason}`);
      break;
    }

    case 'adapters': {
      line('Adapter status (true state, never a guess):');
      const states = await kaido.adapterStatus();
      if (states.length === 0) {
        line('  No adapters mounted. Set KAIDO_ADAPTERS=true to mount the defaults.');
      }
      for (const a of states) {
        const mark = a.state === 'MOUNTED' ? 'MOUNTED ' : a.state === 'NOT_MOUNTED' ? 'OFF     ' : 'UNAVAIL ';
        line(`  ${a.id.padEnd(10)} ${mark} ${a.detail ?? ''}`);
        line(`      capabilities: ${a.capabilities.join(', ')}`);
      }
      break;
    }

    case 'stop': {
      kaido.stop();
      line('EMERGENCY STOP engaged. All agents and automations are halted.');
      break;
    }

    case 'resume': {
      kaido.resume();
      line('KAIDO resumed.');
      break;
    }

    default:
      line(`Unknown command: ${cmd}`);
      line('');
      line(HELP);
      process.exitCode = 1;
  }
}

const HELP = `KAIDO — personal AI Agent Operating System (headless CLI)

  kaido status                        runtime + agent status
  kaido agents                        list agents
  kaido templates                     list built-in templates
  kaido add-template <id>             instantiate a template as a child agent
  kaido add-all-templates             instantiate every built-in template
  kaido tools                         list registered tools
  kaido ask "<goal>"                  Master Agent plans, delegates, reports
  kaido doctor                        diagnose the AI provider (start here if a task fails)
  kaido create-agent "<description>"  propose an agent from natural language
  kaido activity [agentId]            recent audit entries
  kaido automations                   list automation rules
  kaido permissions                   list the granular permission catalogue
  kaido validate-command "<cmd>"      run a command through the Termux allowlist
  kaido adapters                      adapter status (files, web, termux)
  kaido stop | resume                 emergency stop / resume

Built-in templates: ${TEMPLATE_LIST.map((t) => t.id).join(', ')}`;

main().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
