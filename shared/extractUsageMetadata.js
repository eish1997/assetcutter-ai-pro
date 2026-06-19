/**
 * 从 Gemini / OpenAI 兼容响应中提取 usageMetadata（代理与前端记账共用）。
 */
function asPlainObject(value) {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.toJSON === 'function') {
    try {
      const j = value.toJSON();
      if (j && typeof j === 'object') return j;
    } catch {
      /* ignore */
    }
  }
  return value;
}

function normalizeUsageMetadata(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const promptTokenCount =
    Number(
      raw.promptTokenCount ??
        raw.prompt_token_count ??
        raw.prompt_tokens ??
        raw.input_tokens
    ) || 0;
  const candidatesTokenCount =
    Number(
      raw.candidatesTokenCount ??
        raw.candidates_token_count ??
        raw.completion_tokens ??
        raw.output_tokens
    ) || 0;
  const totalTokenCount =
    Number(raw.totalTokenCount ?? raw.total_token_count ?? raw.total_tokens) ||
    promptTokenCount + candidatesTokenCount;
  if (!promptTokenCount && !candidatesTokenCount && !totalTokenCount) return null;
  return { promptTokenCount, candidatesTokenCount, totalTokenCount };
}

function carriersFromResponse(response) {
  const plain = asPlainObject(response);
  if (!plain) return [];
  const list = [
    plain,
    plain.response,
    plain.usageMetadata,
    plain.usage_metadata,
    plain.usage,
    plain.metadata?.usage,
    plain.result?.usageMetadata,
    plain.result?.usage,
  ];
  return list.filter((x) => x && typeof x === 'object');
}

/** @param {unknown} response */
export function extractUsageMetadata(response) {
  for (const carrier of carriersFromResponse(response)) {
    const direct = normalizeUsageMetadata(carrier);
    if (direct) return direct;
    const nested =
      carrier.usageMetadata ||
      carrier.usage_metadata ||
      carrier.metadata ||
      carrier.usage ||
      null;
    const fromNested = normalizeUsageMetadata(nested);
    if (fromNested) return fromNested;
  }
  return null;
}

/** 代理 async 完成后的 result 包（可能 usageMetadata 在顶层或嵌套） */
export function extractUsageMetadataFromProxyResult(result) {
  if (!result || typeof result !== 'object') return null;
  const direct = extractUsageMetadata(result);
  if (direct) return direct;
  const r = /** @type {Record<string, unknown>} */ (result);
  if (r.usageMetadata) return normalizeUsageMetadata(r.usageMetadata);
  return null;
}
