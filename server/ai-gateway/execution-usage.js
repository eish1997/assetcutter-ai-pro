import {
  meterKindForAiGatewayModality,
  resolveAiGatewayBillingSku,
  unitForAiGatewayMeter,
} from './route-billing.js';

function positiveInt(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function positiveMoney(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function estimateCreditsFromPlan(plan) {
  const job = plan?.job || {};
  const metadata = job.metadata && typeof job.metadata === 'object' ? job.metadata : {};
  const gate = metadata.creditsGate && typeof metadata.creditsGate === 'object' ? metadata.creditsGate : {};
  return positiveInt(job.input?.estimatedCredits) || positiveInt(gate.estimatedCredits || gate.reserveAmount) || positiveInt(job.estimatedCredits);
}

export function collectByteSize(value, depth = 0) {
  if (depth > 5 || value == null) return 0;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + collectByteSize(item, depth + 1), 0);
  if (typeof value !== 'object') return 0;
  let total = 0;
  for (const [key, raw] of Object.entries(value)) {
    if (/^(bytes|byteSize|size|fileSize|contentLength)$/i.test(key)) {
      total += positiveInt(raw);
    } else {
      total += collectByteSize(raw, depth + 1);
    }
  }
  return total;
}

/** OpenAI / 聚合商兼容：从 response.usage 提取 token 用量。 */
export function extractOpenAiStyleTokenUsage(raw) {
  const root = raw && typeof raw === 'object' ? raw : null;
  if (!root) return null;
  const usage =
    (root.usage && typeof root.usage === 'object' && !Array.isArray(root.usage) && root.usage) ||
    (root.data?.usage && typeof root.data.usage === 'object' && root.data.usage) ||
    null;
  if (!usage) return null;
  const promptTokens = positiveInt(
    usage.prompt_tokens ?? usage.promptTokens ?? usage.input_tokens ?? usage.inputTokens
  );
  const completionTokens = positiveInt(
    usage.completion_tokens ?? usage.completionTokens ?? usage.output_tokens ?? usage.outputTokens
  );
  const totalTokens =
    positiveInt(usage.total_tokens ?? usage.totalTokens) || promptTokens + completionTokens;
  if (!promptTokens && !completionTokens && !totalTokens) return null;
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    usageMetadata: {
      promptTokenCount: promptTokens,
      candidatesTokenCount: completionTokens,
      totalTokenCount: totalTokens,
    },
  };
}

/** 供应商响应中的 USD 成本（若有）。 */
export function extractProviderCostUsd(raw) {
  const root = raw && typeof raw === 'object' ? raw : null;
  if (!root) return 0;
  const candidates = [
    root.usage?.cost,
    root.usage?.cost_usd,
    root.usage?.costUsd,
    root.usage?.total_cost,
    root.cost,
    root.cost_usd,
    root.costUsd,
    root.data?.cost,
    root.data?.cost_usd,
    root.data?.usage?.cost,
    root.data?.usage?.cost_usd,
  ];
  for (const value of candidates) {
    const n = positiveMoney(value);
    if (n > 0) return n;
  }
  return 0;
}

/** Tripo / 任务类：供应商消耗积分（若有）。 */
export function extractProviderConsumedCredits(raw) {
  const root = raw && typeof raw === 'object' ? raw : null;
  if (!root) return 0;
  const candidates = [
    root.usage?.credits,
    root.usage?.consumed_credits,
    root.usage?.consumedCredits,
    root.consumed_credits,
    root.consumedCredits,
    root.credits,
    root.data?.consumed_credits,
    root.data?.consumedCredits,
    root.data?.credits,
    root.data?.usage?.credits,
    root.data?.usage?.consumed_credits,
  ];
  for (const value of candidates) {
    const n = positiveInt(value);
    if (n > 0) return n;
  }
  return 0;
}

export function buildProviderTaskUsage(plan, input = {}) {
  const estimatedCredits = estimateCreditsFromPlan(plan);
  const tokenFromInput =
    input.usageMetadata && typeof input.usageMetadata === 'object'
      ? {
          promptTokens: positiveInt(
            input.usageMetadata.promptTokenCount ?? input.usageMetadata.prompt_tokens ?? input.promptTokens
          ),
          completionTokens: positiveInt(
            input.usageMetadata.candidatesTokenCount ??
              input.usageMetadata.completion_tokens ??
              input.completionTokens
          ),
          totalTokens: positiveInt(
            input.usageMetadata.totalTokenCount ?? input.usageMetadata.total_tokens ?? input.totalTokens
          ),
          usageMetadata: {
            promptTokenCount: positiveInt(
              input.usageMetadata.promptTokenCount ?? input.usageMetadata.prompt_tokens ?? input.promptTokens
            ),
            candidatesTokenCount: positiveInt(
              input.usageMetadata.candidatesTokenCount ??
                input.usageMetadata.completion_tokens ??
                input.completionTokens
            ),
            totalTokenCount: positiveInt(
              input.usageMetadata.totalTokenCount ?? input.usageMetadata.total_tokens ?? input.totalTokens
            ),
          },
        }
      : null;
  const promptTokens = positiveInt(input.promptTokens) || tokenFromInput?.promptTokens || 0;
  const completionTokens = positiveInt(input.completionTokens) || tokenFromInput?.completionTokens || 0;
  const totalTokens =
    positiveInt(input.totalTokens) ||
    tokenFromInput?.totalTokens ||
    (promptTokens + completionTokens > 0 ? promptTokens + completionTokens : 0);
  const usageMetadata =
    tokenFromInput?.usageMetadata ||
    (promptTokens || completionTokens || totalTokens
      ? {
          promptTokenCount: promptTokens,
          candidatesTokenCount: completionTokens,
          totalTokenCount: totalTokens || promptTokens + completionTokens,
        }
      : undefined);
  if (usageMetadata && !usageMetadata.totalTokenCount) {
    usageMetadata.totalTokenCount = usageMetadata.promptTokenCount + usageMetadata.candidatesTokenCount;
  }

  const costUsd = positiveMoney(input.costUsd ?? input.cost_usd);
  const actualCredits = positiveInt(input.actualCredits) || estimatedCredits;
  const quantity = positiveInt(input.quantity) || 1;
  const startedAtMs = Number(input.startedAtMs || 0);
  const completedAtMs = Number(input.completedAtMs || Date.now());
  const durationMs = startedAtMs > 0 ? Math.max(0, Math.round(completedAtMs - startedAtMs)) : null;
  const outputBytes = positiveInt(input.outputBytes);
  const meterKind = nonEmptyString(input.meterKind) || meterKindForAiGatewayModality(plan?.job?.modality);
  return {
    provider: nonEmptyString(input.provider) || nonEmptyString(plan?.route?.providerId) || nonEmptyString(plan?.job?.provider) || 'ai-gateway',
    upstreamTaskId: nonEmptyString(input.upstreamTaskId) || nonEmptyString(plan?.job?.metadata?.upstreamTaskId) || null,
    billingSku: nonEmptyString(input.billingSku) || resolveAiGatewayBillingSku(plan),
    meterKind,
    unit: nonEmptyString(input.unit) || unitForAiGatewayMeter(meterKind),
    quantity,
    outputBytes,
    artifactCount: positiveInt(input.artifactCount),
    durationMs,
    actualCredits,
    creditsCharged: actualCredits,
    estimatedCredits,
    settlementSource: actualCredits > 0 ? 'provider_task_usage' : 'estimated',
    // B10: 真实用量字段（供 usage-event / 趋势按供应商汇总）
    ...(promptTokens ? { promptTokens } : {}),
    ...(completionTokens ? { completionTokens } : {}),
    ...(totalTokens ? { totalTokens } : {}),
    ...(costUsd ? { costUsd, costUsdEst: costUsd } : {}),
    ...(usageMetadata ? { usageMetadata } : {}),
  };
}
