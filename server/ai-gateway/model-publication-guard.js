import { AiGatewayValidationError } from './job.js';

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function uniqueStrings(values) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const id = nonEmptyString(value);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function resolveRequestedCanonicalModelId(input) {
  const raw = input && typeof input === 'object' ? input : {};
  const metadata = raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {};
  return (
    nonEmptyString(raw.canonicalModelId) ||
    nonEmptyString(metadata.canonicalModelId) ||
    nonEmptyString(raw.registryId) ||
    nonEmptyString(raw.model) ||
    nonEmptyString(raw.input?.canonicalModelId) ||
    nonEmptyString(raw.input?.registryId) ||
    nonEmptyString(raw.input?.model)
  );
}

export function validateAiGatewayModelPublication(input, modelOpsConfig = {}) {
  const allowlist = uniqueStrings(modelOpsConfig?.publishedCanonicalModelAllowlist);
  if (!allowlist.length) {
    return { ok: true, canonicalModelId: resolveRequestedCanonicalModelId(input) || null, restricted: false };
  }

  const canonicalModelId = resolveRequestedCanonicalModelId(input);
  if (!canonicalModelId) {
    throw new AiGatewayValidationError(
      'AI model is required when workspace model publishing is restricted',
      'AI_GATEWAY_MODEL_NOT_PUBLISHED'
    );
  }
  if (!allowlist.includes(canonicalModelId)) {
    throw new AiGatewayValidationError(
      `AI model is not published to the workspace: ${canonicalModelId}`,
      'AI_GATEWAY_MODEL_NOT_PUBLISHED'
    );
  }
  return { ok: true, canonicalModelId, restricted: true };
}
