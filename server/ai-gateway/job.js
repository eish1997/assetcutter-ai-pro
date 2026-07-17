import crypto from 'crypto';

export const AI_JOB_MODALITIES = Object.freeze(['text', 'image', 'music', 'video', 'model3d']);
export const AI_JOB_STATUSES = Object.freeze(['created', 'queued', 'running', 'succeeded', 'failed', 'cancelled']);
const AI_JOB_STATUS_SET = new Set(AI_JOB_STATUSES);

const MODALITY_ALIASES = new Map([
  ['3d', 'model3d'],
  ['model_3d', 'model3d'],
  ['model-3d', 'model3d'],
  ['model3d', 'model3d'],
  ['text', 'text'],
  ['image', 'image'],
  ['music', 'music'],
  ['audio', 'music'],
  ['video', 'video'],
]);

export class AiGatewayValidationError extends Error {
  constructor(message, code = 'AI_GATEWAY_INVALID_JOB', details = null) {
    super(message);
    this.name = 'AiGatewayValidationError';
    this.code = code;
    if (details && typeof details === 'object') this.details = details;
  }
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function normalizeAiJobModality(value) {
  const key = nonEmptyString(value)?.toLowerCase();
  const normalized = key ? MODALITY_ALIASES.get(key) : null;
  if (!normalized) {
    throw new AiGatewayValidationError(`Unsupported AI job modality: ${String(value || '')}`, 'AI_GATEWAY_MODALITY_UNSUPPORTED');
  }
  return normalized;
}

export function createAiJobId(prefix = 'aijob') {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function createAiJobDraft(input, options = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  const modality = normalizeAiJobModality(raw.modality);
  const capability = nonEmptyString(raw.capability) || `${modality}.generate`;
  const nowIso = options.nowIso || new Date().toISOString();
  const payload = raw.input && typeof raw.input === 'object' ? raw.input : {};

  return {
    id: nonEmptyString(raw.id) || createAiJobId(),
    status: 'created',
    modality,
    capability,
    provider: nonEmptyString(raw.provider),
    model: nonEmptyString(raw.model),
    userId: nonEmptyString(raw.userId),
    correlationId: nonEmptyString(raw.correlationId) || createAiJobId('corr'),
    input: payload,
    metadata: raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {},
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export function normalizeAiJobStatus(value) {
  const status = nonEmptyString(value)?.toLowerCase();
  if (!status || !AI_JOB_STATUS_SET.has(status)) {
    throw new AiGatewayValidationError(`Unsupported AI job status: ${String(value || '')}`, 'AI_GATEWAY_STATUS_UNSUPPORTED');
  }
  return status;
}

export function applyAiJobStatusPatch(plan, patch, options = {}) {
  if (!plan?.job) {
    throw new AiGatewayValidationError('Missing AI job plan', 'AI_GATEWAY_JOB_NOT_FOUND');
  }
  const raw = patch && typeof patch === 'object' ? patch : {};
  const nowIso = options.nowIso || new Date().toISOString();
  const status = normalizeAiJobStatus(raw.status || plan.job.status);
  const metadata = raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {};
  const job = {
    ...plan.job,
    status,
    metadata: {
      ...(plan.job.metadata && typeof plan.job.metadata === 'object' ? plan.job.metadata : {}),
      ...metadata,
    },
    updatedAt: nowIso,
  };

  if (raw.output !== undefined) job.output = raw.output;
  if (raw.artifacts !== undefined) job.artifacts = Array.isArray(raw.artifacts) ? raw.artifacts : [];
  if (raw.error !== undefined) job.error = raw.error;
  if (raw.startedAt || (status === 'running' && !job.startedAt)) job.startedAt = raw.startedAt || nowIso;
  if (raw.finishedAt || status === 'succeeded' || status === 'failed' || status === 'cancelled') {
    job.finishedAt = raw.finishedAt || nowIso;
  }

  return {
    ...plan,
    job,
  };
}
