/**
 * Frozen public job contract for workbench / clients consuming GET/POST /api/ai/jobs.
 * Detail responses may add `output` / `artifacts` / full `metadata`; list/summary
 * must keep these keys stable. Prefer artifacts[] over provider-specific URL scraping.
 */

export const AI_GATEWAY_PUBLIC_JOB_CONTRACT_FIELDS = Object.freeze([
  'id',
  'status',
  'modality',
  'capability',
  'provider',
  'model',
  'userId',
  'correlationId',
  'createdAt',
  'updatedAt',
  'startedAt',
  'finishedAt',
  'route',
  'routeDecision',
  'gatewayFailure',
  'fallback',
  'error',
  'observability',
]);

/** Detail-only fields (publicAuthAiJobDetail.job). */
export const AI_GATEWAY_PUBLIC_JOB_DETAIL_EXTRA_FIELDS = Object.freeze([
  'metadata',
  'output',
  'artifacts',
]);

/**
 * Stable failureReason.shape (attachFailureReason / gatewayFailure):
 * code, stage, owner, retryable, userMessage, adminMessage, nextAction (+ optional httpStatus).
 */
export const AI_GATEWAY_FAILURE_REASON_FIELDS = Object.freeze([
  'code',
  'stage',
  'owner',
  'retryable',
  'userMessage',
  'adminMessage',
  'nextAction',
]);

export const AI_GATEWAY_SUPPORTED_MODALITIES = Object.freeze(['text', 'image', 'video', 'model3d']);
