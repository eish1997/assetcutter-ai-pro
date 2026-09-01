import {
  gatewayFailureMetadata,
  publicAiGatewayFailureReason,
  resolveAiGatewayFailureReason,
  decorateErrorWithFailureReason,
} from './failure-reason.js';

export const AI_GATEWAY_ADAPTER_RESULT_STATUSES = Object.freeze([
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);

export const AI_GATEWAY_ARTIFACT_KINDS = Object.freeze([
  'text',
  'image',
  'video',
  'model3d',
  'music',
]);

const ARTIFACT_KIND_SET = new Set(AI_GATEWAY_ARTIFACT_KINDS);
const ARTIFACT_PUBLIC_KEYS = new Set(['kind', 'url', 'mimeType', 'metadata', 'text']);

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function normalizeArtifactKind(raw) {
  const kind = nonEmptyString(raw).toLowerCase();
  if (kind === 'audio') return 'music';
  if (kind === 'model' || kind === '3d' || kind === 'mesh') return 'model3d';
  if (ARTIFACT_KIND_SET.has(kind)) return kind;
  return '';
}

/**
 * Normalize one artifact into the AiGatewayAdapterResult contract shape.
 * Vendor-only fields are moved into metadata.
 */
export function normalizeAiGatewayAdapterArtifact(raw) {
  const record = asRecord(raw);
  if (!record && typeof raw !== 'string') return null;
  if (typeof raw === 'string') {
    const url = nonEmptyString(raw);
    return url ? { kind: 'image', url } : null;
  }
  const kind = normalizeArtifactKind(record.kind) || (nonEmptyString(record.text) ? 'text' : '');
  const url = nonEmptyString(record.url);
  const text = nonEmptyString(record.text);
  const mimeType = nonEmptyString(record.mimeType) || undefined;
  const metadata = { ...(asRecord(record.metadata) || {}) };
  for (const [key, value] of Object.entries(record)) {
    if (ARTIFACT_PUBLIC_KEYS.has(key)) continue;
    if (value === undefined) continue;
    metadata[key] = value;
  }
  if (!kind) return null;
  if (kind === 'text') {
    if (!text && !url) return null;
    return {
      kind: 'text',
      ...(url ? { url } : {}),
      ...(text ? { text } : {}),
      ...(mimeType ? { mimeType } : {}),
      ...(Object.keys(metadata).length ? { metadata } : {}),
    };
  }
  if (!url) return null;
  return {
    kind,
    url,
    ...(mimeType ? { mimeType } : {}),
    ...(Object.keys(metadata).length ? { metadata } : {}),
  };
}

function normalizeArtifacts(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeAiGatewayAdapterArtifact).filter(Boolean);
}

function outputText(output) {
  const record = asRecord(output);
  if (!record) return '';
  return nonEmptyString(record.text) || nonEmptyString(record.outputText) || nonEmptyString(record.content);
}

/**
 * @typedef {{
 *   status: 'running'|'succeeded'|'failed'|'cancelled',
 *   upstreamTaskId?: string,
 *   output?: Record<string, unknown>,
 *   artifacts?: Array<{kind:string,url?:string,mimeType?:string,text?:string,metadata?:Record<string,unknown>}>,
 *   usage?: Record<string, unknown>,
 *   failureReason?: Record<string, unknown>,
 * }} AiGatewayAdapterResult
 */

/**
 * Normalize any adapter payload into AiGatewayAdapterResult.
 * Private/vendor fields must live under output.raw or artifacts[].metadata.
 */
export function normalizeAiGatewayAdapterResult(input = {}, options = {}) {
  const record = asRecord(input) || {};
  let status = nonEmptyString(record.status).toLowerCase();
  if (status === 'completed' || status === 'success' || status === 'passed') status = 'succeeded';
  if (status === 'error') status = 'failed';
  if (status === 'canceled') status = 'cancelled';
  if (status === 'queued' || status === 'pending') status = 'running';
  if (!AI_GATEWAY_ADAPTER_RESULT_STATUSES.includes(status)) {
    status = options.defaultStatus || 'failed';
  }

  const artifacts = normalizeArtifacts(record.artifacts);
  const usage = asRecord(record.usage) || undefined;
  const upstreamTaskId = nonEmptyString(record.upstreamTaskId) || undefined;

  let output = asRecord(record.output) ? { ...record.output } : {};
  // Fold legacy top-level vendor fields into output.raw / structured slots.
  for (const key of ['modelUrls', 'videoUrl', 'previewUrl', 'raw', 'provider', 'model', 'taskId', 'text']) {
    if (record[key] !== undefined && output[key] === undefined) output[key] = record[key];
  }
  if (usage && !output.usage) output.usage = usage;
  if (upstreamTaskId && !output.upstreamTaskId) output.upstreamTaskId = upstreamTaskId;
  if (artifacts.length && !output.artifacts) output.artifacts = artifacts;
  if (!Object.keys(output).length) output = undefined;

  let failureReason = null;
  if (status === 'failed') {
    const fromInput = asRecord(record.failureReason) || asRecord(record.error?.failureReason);
    failureReason = publicAiGatewayFailureReason(
      resolveAiGatewayFailureReason(fromInput || record.error || record, {
        defaultCode: options.defaultFailureCode || 'AI_GATEWAY_EXECUTION_HANDOFF_FAILED',
        providerId: options.providerId,
        adapterId: options.adapterId,
        workerId: options.workerId,
      })
    );
  }

  /** @type {AiGatewayAdapterResult} */
  const result = {
    status,
    ...(upstreamTaskId ? { upstreamTaskId } : {}),
    ...(output ? { output } : {}),
    ...(artifacts.length ? { artifacts } : {}),
    ...(usage ? { usage } : {}),
    ...(failureReason ? { failureReason } : {}),
  };
  return result;
}

export function validateAiGatewayAdapterResult(result, options = {}) {
  const errors = [];
  if (!result || typeof result !== 'object') {
    return { ok: false, errors: ['missing_result'] };
  }
  if (!AI_GATEWAY_ADAPTER_RESULT_STATUSES.includes(result.status)) {
    errors.push('invalid_status');
  }
  if (result.status === 'succeeded') {
    const modality = nonEmptyString(options.modality).toLowerCase();
    const artifacts = Array.isArray(result.artifacts) ? result.artifacts : [];
    const hasMedia = artifacts.some((row) => row?.url && row.kind !== 'text');
    const hasText =
      Boolean(outputText(result.output)) ||
      artifacts.some((row) => row?.kind === 'text' && (row.text || row.url));
    if (modality === 'text') {
      if (!hasText) errors.push('succeeded_without_text_output');
    } else if (modality === 'image' || modality === 'video' || modality === 'model3d' || modality === 'music') {
      if (!hasMedia) errors.push('succeeded_without_modality_artifact');
    } else if (!hasMedia && !hasText) {
      errors.push('succeeded_without_output_or_artifact');
    }
  }
  if (result.status === 'failed' && !result.failureReason) {
    errors.push('failed_without_failureReason');
  }
  for (const row of Array.isArray(result.artifacts) ? result.artifacts : []) {
    if (!ARTIFACT_KIND_SET.has(row?.kind)) errors.push('artifact_invalid_kind');
    if (row.kind !== 'text' && !nonEmptyString(row.url)) errors.push('artifact_missing_url');
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Build the job store patch from a normalized adapter result.
 * Only contract fields are written to status/output/artifacts/error;
 * extras stay in metadata / output.raw.
 */
export function jobPatchFromAdapterResult(result, options = {}) {
  const normalized = normalizeAiGatewayAdapterResult(result, options);
  const validation = validateAiGatewayAdapterResult(normalized, options);
  let effective = normalized;

  if (normalized.status === 'succeeded' && !validation.ok) {
    const emptyMedia = validation.errors.some((code) =>
      [
        'succeeded_without_modality_artifact',
        'succeeded_without_output_or_artifact',
        'succeeded_without_text_output',
      ].includes(code)
    );
    const failureCode = emptyMedia ? 'AI_GATEWAY_UPSTREAM_EMPTY_IMAGE' : 'AI_GATEWAY_ADAPTER_RESULT_INVALID';
    effective = normalizeAiGatewayAdapterResult(
      {
        status: 'failed',
        upstreamTaskId: normalized.upstreamTaskId,
        output: {
          ...(normalized.output || {}),
          raw: {
            ...(asRecord(normalized.output?.raw) || {}),
            rejectedAdapterResult: normalized,
            contractErrors: validation.errors,
          },
        },
        failureReason: emptyMedia
          ? {
              code: 'AI_GATEWAY_UPSTREAM_EMPTY_IMAGE',
              message: `Upstream returned succeeded without usable ${nonEmptyString(options.modality) || 'media'} artifacts`,
            }
          : {
              code: 'AI_GATEWAY_ADAPTER_RESULT_INVALID',
              message: `Adapter result failed contract: ${validation.errors.join(', ')}`,
            },
      },
      {
        ...options,
        defaultFailureCode: failureCode,
      }
    );
  }

  const patch = {
    status: effective.status,
  };

  if (effective.artifacts) patch.artifacts = effective.artifacts;
  if (effective.output) patch.output = effective.output;
  else if (effective.status === 'succeeded') patch.output = {};

  if (effective.status === 'failed') {
    patch.error = {
      code: effective.failureReason?.code || 'AI_GATEWAY_EXECUTION_HANDOFF_FAILED',
      message:
        effective.failureReason?.adminMessage ||
        effective.failureReason?.userMessage ||
        effective.failureReason?.message ||
        'AI Gateway adapter failed',
      ...(effective.failureReason ? { failureReason: effective.failureReason } : {}),
    };
    patch.metadata = {
      ...(asRecord(options.metadata) || {}),
      ...gatewayFailureMetadata(effective.failureReason || patch.error, {
        defaultCode: patch.error.code,
        providerId: options.providerId,
        adapterId: options.adapterId,
        workerId: options.workerId,
      }),
      ...(effective.upstreamTaskId ? { upstreamTaskId: effective.upstreamTaskId } : {}),
    };
  } else {
    patch.metadata = {
      ...(asRecord(options.metadata) || {}),
      ...(effective.usage ? { usage: effective.usage } : {}),
      ...(effective.upstreamTaskId ? { upstreamTaskId: effective.upstreamTaskId } : {}),
    };
  }

  if (effective.status === 'succeeded' || effective.status === 'failed' || effective.status === 'cancelled') {
    patch.finishedAt = options.finishedAt || new Date().toISOString();
  }

  return { patch, result: effective, validation };
}

export function validateJobAgainstAdapterContract(job) {
  if (!job || typeof job !== 'object') return { ok: false, errors: ['missing_job'] };
  if (job.status === 'succeeded') {
    return validateAiGatewayAdapterResult(
      normalizeAiGatewayAdapterResult({
        status: 'succeeded',
        artifacts: job.artifacts,
        output: job.output,
        usage: asRecord(job.output)?.usage || asRecord(job.metadata)?.usage,
        upstreamTaskId: asRecord(job.metadata)?.upstreamTaskId,
      }),
      { modality: job.modality }
    );
  }
  if (job.status === 'failed') {
    const hasFailure =
      asRecord(job.metadata)?.gatewayFailure ||
      asRecord(job.error)?.failureReason ||
      asRecord(job.error);
    return hasFailure
      ? { ok: true, errors: [] }
      : { ok: false, errors: ['failed_without_failureReason'] };
  }
  return { ok: true, errors: [] };
}

/**
 * Apply a contract adapter result to the job store.
 * Callers should invoke finalizeAiGatewayTerminalPlan for terminal statuses.
 */
export async function applyAiGatewayAdapterResult(plan, resultInput, store, options = {}) {
  if (!plan?.job?.id || !store?.update) {
    return { plan, result: normalizeAiGatewayAdapterResult(resultInput, options), skipped: true };
  }
  const providerId = options.providerId || plan.route?.providerId || plan.job?.provider || null;
  const adapterId = options.adapterId || plan.route?.adapterId || null;
  const workerId = options.workerId || plan.route?.workerId || null;
  const { patch, result } = jobPatchFromAdapterResult(resultInput, {
    ...options,
    providerId,
    adapterId,
    workerId,
    modality: options.modality || plan.job?.modality,
    metadata: {
      ...(asRecord(options.metadata) || {}),
    },
  });
  const next = await store.update(plan.job.id, patch);
  return { plan: next, result, patch };
}

/** 契约层把 succeeded→failed 时不会抛错；调用方须检查并 throw 以触发 executor 同路由重试 */
export function throwIfAdapterPlanTerminalFailed(plan, context = {}) {
  if (!plan?.job || plan.job.status !== 'failed') return;
  const jobError = asRecord(plan.job.error) || {};
  const failureReason = asRecord(jobError.failureReason) || asRecord(asRecord(plan.job.metadata)?.gatewayFailure);
  const code =
    nonEmptyString(failureReason?.code) ||
    nonEmptyString(jobError.code) ||
    'AI_GATEWAY_EXECUTION_HANDOFF_FAILED';
  const message =
    nonEmptyString(failureReason?.adminMessage) ||
    nonEmptyString(failureReason?.userMessage) ||
    nonEmptyString(jobError.message) ||
    'AI Gateway adapter failed';
  const err = new Error(message);
  err.code = code;
  err.status = 502;
  throw decorateErrorWithFailureReason(err, {
    defaultCode: code,
    providerId: context.providerId || plan.route?.providerId || plan.job?.provider || null,
    adapterId: context.adapterId || plan.route?.adapterId || null,
    workerId: context.workerId || plan.route?.workerId || null,
  });
}
