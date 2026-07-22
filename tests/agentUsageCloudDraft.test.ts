import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  COPILOT_USAGE_BILLING_SKU,
  COPILOT_USAGE_UPLOAD_TOOL,
  COPILOT_USAGE_POLICY_PROBE_TOOL,
  buildCopilotUsageCloudDraft,
} = require('../companion-desktop/agent-usage-cloud-draft.cjs');

describe('agent usage cloud draft', () => {
  it('builds the same sanitized draft used by MCP status and shell upload', () => {
    const draft = buildCopilotUsageCloudDraft({
      generatedAt: '2026-07-22T03:04:05.000Z',
      windowDays: 7,
      totals: {
        turns: 3,
        inputTokens: 120,
        cachedInputTokens: 40,
        freshInputTokens: 80,
        outputTokens: 50,
        reasoningOutputTokens: 5,
        totalTokens: 175,
      },
    });

    expect(draft).toMatchObject({
      targetApi: '/api/usage/events',
      currentPhase: 'cloud_event_draft',
      eventCount: 1,
      idempotencyScope: 'copilot-local-2026-07-22-7d',
      uploadPlan: {
        endpoint: '/api/usage/events',
        credentials: 'include',
        tool: COPILOT_USAGE_UPLOAD_TOOL,
        idempotencyScope: 'copilot-local-2026-07-22-7d',
        serverContract: {
          store: 'usage-billing-store.insertUsageEvents',
          userBinding: 'server derives userId from the authenticated session',
        },
      },
      quotaPolicy: {
        billingSku: COPILOT_USAGE_BILLING_SKU,
        billingSkuRegisteredInDefaultCatalog: true,
        usageBillingApiConfigured: true,
        cloudQuotaEnforced: false,
        probeTool: COPILOT_USAGE_POLICY_PROBE_TOOL,
        policyEndpoint: '/api/usage/policy',
      },
    });
    expect(draft.privacy.excludes).toEqual(
      expect.arrayContaining(['raw_prompts', 'tool_arguments', 'secrets', 'mcp_tokens', 'cookie_values']),
    );
    expect(draft.events[0]).toMatchObject({
      idempotencyKey: 'copilot-local-2026-07-22-7d',
      provider: 'openai',
      billingSku: 'copilot.codex.tokens',
      meterKind: 'token',
      quantityIn: 120,
      quantityOut: 55,
      quantity: 175,
      jobKind: 'copilot',
      meta: {
        source: 'local_companion_audit_log',
        governanceDraft: true,
        windowDays: 7,
        turns: 3,
        cachedInputTokens: 40,
        freshInputTokens: 80,
        reasoningOutputTokens: 5,
      },
    });
    expect(JSON.stringify(draft.events)).not.toContain('prompt');
    expect(JSON.stringify(draft.events)).not.toContain('cookie_values_secret');
  });

  it('marks empty local usage as a non-uploadable draft', () => {
    const draft = buildCopilotUsageCloudDraft({
      generatedAt: '2026-07-22T03:04:05.000Z',
      windowDays: 1,
      totals: { turns: 0, totalTokens: 0 },
    });

    expect(draft.eventCount).toBe(0);
    expect(draft.events).toEqual([]);
    expect(draft.uploadReady).toBe(false);
    expect(draft.blockedBy).toEqual(
      expect.arrayContaining([
        'authenticated_team_session_required',
        'cloud_quota_policy_not_enabled',
        'no_local_usage_events',
      ]),
    );
  });

  it('removes the quota-policy blocker when a cloud enforcement policy is supplied', () => {
    const draft = buildCopilotUsageCloudDraft(
      {
        generatedAt: '2026-07-22T03:04:05.000Z',
        windowDays: 1,
        totals: { turns: 1, inputTokens: 10, outputTokens: 4, totalTokens: 14 },
      },
      {
        quotaPolicy: {
          cloudQuotaEnforced: true,
          usageBillingEnabled: true,
          enforcementSource: 'team_policy',
          policyId: 'copilot-team-quota-v1',
          checkedAt: '2026-07-22T03:05:00.000Z',
        },
      },
    );

    expect(draft.eventCount).toBe(1);
    expect(draft.blockedBy).toContain('authenticated_team_session_required');
    expect(draft.blockedBy).not.toContain('cloud_quota_policy_not_enabled');
    expect(draft.quotaPolicy).toMatchObject({
      cloudQuotaEnforced: true,
      usageBillingEnabled: true,
      enforcementSource: 'team_policy',
      policyId: 'copilot-team-quota-v1',
      checkedAt: '2026-07-22T03:05:00.000Z',
      probeTool: COPILOT_USAGE_POLICY_PROBE_TOOL,
    });
  });
});
