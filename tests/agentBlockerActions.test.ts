import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  STATUS_COMMAND,
  WORKBENCH_OPEN_LOGIN_WAIT_COMMAND,
  workbenchLoginActions,
  workflowPromotionActions,
  usageGovernanceActions,
} = require('../companion-desktop/agent-blocker-actions.cjs');

describe('agent blocker action contract', () => {
  it('builds shared actions for MCP server-status and local shell settings', () => {
    expect(STATUS_COMMAND).toBe('npm run smoke:agent-mcp:status');
    expect(WORKBENCH_OPEN_LOGIN_WAIT_COMMAND).toBe('npm run smoke:agent-mcp:e2e:open-login-wait');

    expect(workbenchLoginActions()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'open_login_and_wait_e2e',
          command: WORKBENCH_OPEN_LOGIN_WAIT_COMMAND,
          owner: 'user',
          risk: 'safe',
        }),
      ]),
    );

    expect(workflowPromotionActions()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'promote_workbench_preset_preflight',
          tool: 'ac.workflow.promote_workbench_preset',
          args: { skillId: '<workflow-draft-skill-id>', requireAdminConfirmation: true },
          requiredInputs: [
            expect.objectContaining({
              name: 'skillId',
              source: 'settings.workflowPromotionSkillId',
            }),
          ],
          owner: 'admin',
          risk: 'confirm-risk',
        }),
        expect.objectContaining({
          id: 'promote_script_hub_tool_preflight',
          tool: 'ac.workflow.promote_script_hub_tool',
          requiredInputs: [
            expect.objectContaining({
              name: 'skillId',
              source: 'settings.workflowPromotionSkillId',
            }),
          ],
        }),
      ]),
    );

    expect(usageGovernanceActions()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'probe_quota_policy',
          tool: 'ac.usage.probe_quota_policy',
          risk: 'safe',
        }),
        expect.objectContaining({
          id: 'dry_run_usage_upload',
          tool: 'ac.usage.upload_cloud_draft',
          args: { dryRun: true, days: 1, limit: 5000 },
          risk: 'confirm-risk',
        }),
        expect.objectContaining({
          id: 'open_workbench_login',
          command: WORKBENCH_OPEN_LOGIN_WAIT_COMMAND,
          owner: 'user',
        }),
      ]),
    );
  });

  it('returns fresh action objects so callers cannot mutate the shared contract', () => {
    const first = workflowPromotionActions();
    first[2].requiredInputs[0].name = 'changed';
    const second = workflowPromotionActions();

    expect(second[2].requiredInputs[0].name).toBe('skillId');
  });
});
