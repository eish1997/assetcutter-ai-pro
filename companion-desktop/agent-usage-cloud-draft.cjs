'use strict';

const COPILOT_USAGE_BILLING_SKU = 'copilot.codex.tokens';
const COPILOT_USAGE_UPLOAD_TOOL = 'ac.usage.upload_cloud_draft';
const COPILOT_USAGE_POLICY_PROBE_TOOL = 'ac.usage.probe_quota_policy';
const COPILOT_USAGE_ENDPOINT = '/api/usage/events';
const COPILOT_USAGE_POLICY_ENDPOINT = '/api/usage/policy';
const COPILOT_USAGE_PRIVACY_EXCLUDES = ['raw_prompts', 'tool_arguments', 'secrets', 'mcp_tokens', 'cookie_values'];

function buildCopilotUsageCloudDraft(summary, options) {
  const current = summary && typeof summary === 'object' ? summary : null;
  const opts = options && typeof options === 'object' ? options : {};
  const suppliedPolicy = opts.quotaPolicy && typeof opts.quotaPolicy === 'object' ? opts.quotaPolicy : {};
  const cloudQuotaEnforced = Boolean(suppliedPolicy.cloudQuotaEnforced);
  const totals = current && current.totals && typeof current.totals === 'object' ? current.totals : {};
  const turns = Number(totals.turns) || 0;
  const inputTokens = Number(totals.inputTokens) || 0;
  const cachedInputTokens = Number(totals.cachedInputTokens) || 0;
  const freshInputTokens = Number(totals.freshInputTokens) || Math.max(0, inputTokens - cachedInputTokens);
  const outputTokens = Number(totals.outputTokens) || 0;
  const reasoningOutputTokens = Number(totals.reasoningOutputTokens) || 0;
  const totalTokens = Number(totals.totalTokens) || inputTokens + outputTokens + reasoningOutputTokens;
  const windowDays = Number(current && current.windowDays) || 1;
  const day = String(current && current.generatedAt ? current.generatedAt : new Date().toISOString()).slice(0, 10);
  const hasUsage = turns > 0 || totalTokens > 0;
  const blockedBy = ['authenticated_team_session_required'];
  if (!cloudQuotaEnforced) blockedBy.push('cloud_quota_policy_not_enabled');
  if (!hasUsage) blockedBy.push('no_local_usage_events');
  const eventIdempotencyKey = `copilot-local-${day}-${windowDays}d`;
  const uploadPlan = {
    endpoint: COPILOT_USAGE_ENDPOINT,
    method: 'POST',
    credentials: 'include',
    tool: COPILOT_USAGE_UPLOAD_TOOL,
    bodyShape: '{ events: cloudDraft.events }',
    idempotencyKeyField: 'idempotencyKey',
    idempotencyScope: eventIdempotencyKey,
    serverContract: {
      auth: 'requireAuth session cookie',
      csrf: 'exempted for /api/usage/events; protected by session and write-origin checks',
      rateLimitKey: 'usage-events:{user.id}',
      store: 'usage-billing-store.insertUsageEvents',
      userBinding: 'server derives userId from the authenticated session',
    },
    retry: {
      safeToRetry: true,
      reason: 'The server deduplicates by idempotencyKey.',
    },
  };
  const quotaPolicy = {
    currentPhase: 'usage_event_ingestion_ready',
    billingSku: COPILOT_USAGE_BILLING_SKU,
    billingSkuRegisteredInDefaultCatalog: true,
    usageBillingApiConfigured: true,
    cloudQuotaEnforced,
    usageBillingEnabled: Boolean(suppliedPolicy.usageBillingEnabled),
    enforcementSource: suppliedPolicy.enforcementSource ? String(suppliedPolicy.enforcementSource) : '',
    policyId: suppliedPolicy.policyId ? String(suppliedPolicy.policyId) : '',
    checkedAt: suppliedPolicy.checkedAt ? String(suppliedPolicy.checkedAt) : '',
    probeTool: COPILOT_USAGE_POLICY_PROBE_TOOL,
    policyEndpoint: COPILOT_USAGE_POLICY_ENDPOINT,
    requiredToExitBlocker: ['authenticated_team_session', 'credits_or_quota_enforcement_policy'],
  };
  return {
    targetApi: COPILOT_USAGE_ENDPOINT,
    currentPhase: 'cloud_event_draft',
    cloudEnforced: false,
    uploadReady: false,
    blockedBy,
    idempotencyScope: eventIdempotencyKey,
    uploadPlan,
    quotaPolicy,
    eventCount: hasUsage ? 1 : 0,
    events: hasUsage
      ? [
          {
            idempotencyKey: eventIdempotencyKey,
            provider: 'openai',
            billingSku: COPILOT_USAGE_BILLING_SKU,
            meterKind: 'token',
            unit: 'token',
            quantityIn: inputTokens,
            quantityOut: outputTokens + reasoningOutputTokens,
            quantity: totalTokens,
            status: 'succeeded',
            costConfidence: 'unknown',
            jobKind: 'copilot',
            meta: {
              source: 'local_companion_audit_log',
              governanceDraft: true,
              windowDays,
              turns,
              cachedInputTokens,
              freshInputTokens,
              reasoningOutputTokens,
            },
          },
        ]
      : [],
    privacy: {
      excludes: [...COPILOT_USAGE_PRIVACY_EXCLUDES],
    },
    nextStep:
      'After the shell has an authenticated team session and a cloud quota policy is enabled, upload these sanitized draft events to /api/usage/events or a dedicated Copilot usage ingestion endpoint.',
  };
}

module.exports = {
  COPILOT_USAGE_BILLING_SKU,
  COPILOT_USAGE_UPLOAD_TOOL,
  COPILOT_USAGE_POLICY_PROBE_TOOL,
  COPILOT_USAGE_ENDPOINT,
  COPILOT_USAGE_POLICY_ENDPOINT,
  COPILOT_USAGE_PRIVACY_EXCLUDES,
  buildCopilotUsageCloudDraft,
};
