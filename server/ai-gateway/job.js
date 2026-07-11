import crypto from 'crypto';

export const AI_JOB_MODALITIES = Object.freeze(['text', 'image', 'music', 'video', 'model3d']);

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
  constructor(message, code = 'AI_GATEWAY_INVALID_JOB') {
    super(message);
    this.name = 'AiGatewayValidationError';
    this.code = code;
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
