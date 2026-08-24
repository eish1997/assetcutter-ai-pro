import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAgentBodyHost } = require('../companion-desktop/agent-body-host.cjs');

const calls = [];
const host = createAgentBodyHost({
  getShellView: () => 'connections',
  navigateShell: async () => ({ ok: true }),
  getStateSummary: async () => ({}),
  companionApiRequest: async (method, pathname, body) => {
    calls.push({ method, pathname, body });
    if (pathname.endsWith('/context')) {
      return {
        ok: true,
        json: {
          ok: true,
          connectionState: {
            maturity: 'strategy_draft',
            label: '策略草稿',
            availableActions: ['agent_loop', 'conversation'],
            nextAction: '选择下一候选策略',
            facts: {
              executablePath: 'C:/Smoke/CodexSmokeApp.exe',
              confidence: 0.72,
            },
          },
          strategyDraft: {
            candidateStrategies: [
              { id: 'script-folder', label: '脚本目录', kind: 'script_folder' },
              { id: 'manual-bridge-script', label: '手动桥接脚本', kind: 'manual_bridge_script' },
            ],
            recommendedNextStrategy: { id: 'script-folder', label: '脚本目录', kind: 'script_folder' },
          },
        },
      };
    }
    if (pathname.endsWith('/events')) return { ok: true, json: { ok: true, event: body } };
    if (pathname.endsWith('/lifecycle')) return { ok: true, json: { ok: true, action: body?.action } };
    return { ok: false, status: 404, text: `unexpected ${method} ${pathname}` };
  },
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const result = await host.executeTool(
  'ac.capability.connection_loop_run',
  {
    id: 'unknown-app',
    goal: '继续连接未知软件',
    permissions: ['context.read', 'event.write', 'conversation.open'],
    failedStrategyId: 'script-folder',
    failureClass: 'missing_path',
    failureMessage: '脚本目录不存在',
  },
  {},
);

assert(result.ok === true, 'connection_loop_run did not return ok=true');
assert(result.structured?.maturity === 'strategy_draft', 'loop did not read strategy_draft maturity');
assert(result.structured?.nextAction === 'run_next_connection_strategy', 'loop did not select next strategy');

const failed = calls.find((call) => call.pathname === '/v1/capability-packages/unknown-app/events' && call.body?.kind === 'connection_strategy_failed');
const next = calls.find((call) => call.pathname === '/v1/capability-packages/unknown-app/events' && call.body?.kind === 'connection_strategy_next_selected');

assert(Boolean(failed), 'connection_strategy_failed event was not written');
assert(failed.body?.detail?.strategyId === 'script-folder', 'failed event strategyId mismatch');
assert(failed.body?.detail?.failureClass === 'missing_path', 'failed event failureClass mismatch');
assert(failed.body?.detail?.nextCandidateStrategy?.id === 'manual-bridge-script', 'failed event nextCandidateStrategy mismatch');
assert(Boolean(next), 'connection_strategy_next_selected event was not written');
assert(next.body?.ok === true, 'next strategy event did not report ok=true');
assert(next.body?.detail?.nextCandidateStrategy?.id === 'manual-bridge-script', 'next strategy event candidate mismatch');

console.log(JSON.stringify({
  ok: true,
  maturity: result.structured.maturity,
  plannedSteps: result.structured.plannedSteps,
  nextAction: result.structured.nextAction,
  failedStrategyId: failed.body.detail.strategyId,
  nextCandidateStrategy: next.body.detail.nextCandidateStrategy.id,
}, null, 2));
