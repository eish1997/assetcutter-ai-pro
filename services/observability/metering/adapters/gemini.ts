import type { UsageGeminiMetadata } from '../../../../shared/usageBilling';
import type { MeterModality, MeterPart, MeterReading } from '../../../../shared/observability/meterReading';
import { extractUsageMetadataFromProxyResult } from '../../../../shared/extractUsageMetadata.js';
import { isLikelyImageRegistryId } from '../resolveBillingSku';

export function parseGeminiTokenCounts(
  usage: UsageGeminiMetadata | null | undefined
): { prompt: number; candidates: number } {
  const prompt = Math.max(0, Math.floor(Number(usage?.promptTokenCount) || 0));
  const candidates = Math.max(0, Math.floor(Number(usage?.candidatesTokenCount) || 0));
  return { prompt, candidates };
}

export function meterReadingFromGeminiProxy(args: {
  registryId: string;
  provider: string;
  usageMetadata?: UsageGeminiMetadata | null;
  proxyResult?: unknown;
}): MeterReading {
  const usageMetadata =
    args.usageMetadata ?? extractUsageMetadataFromProxyResult(args.proxyResult) ?? null;
  const modality: MeterModality = isLikelyImageRegistryId(args.registryId) ? 'image' : 'text';
  const { prompt, candidates } = parseGeminiTokenCounts(usageMetadata);
  const parts: MeterPart[] = [];

  if (modality === 'text') {
    if (prompt > 0) parts.push({ kind: 'input_token', quantity: prompt, unit: 'token' });
    if (candidates > 0) parts.push({ kind: 'output_token', quantity: candidates, unit: 'token' });
    return {
      provider: args.provider,
      modality,
      parts,
      rawUsage: usageMetadata ?? undefined,
      confidence: prompt > 0 || candidates > 0 ? 'exact' : 'estimated',
    };
  }

  if (prompt > 0) parts.push({ kind: 'input_token', quantity: prompt, unit: 'token' });
  if (candidates > 0) {
    parts.push({ kind: 'output_token', quantity: candidates, unit: 'token' });
  } else {
    parts.push({ kind: 'output_image', quantity: 1, unit: 'image' });
  }

  return {
    provider: args.provider,
    modality: 'image',
    parts,
    rawUsage: usageMetadata ?? undefined,
    confidence:
      prompt > 0 || candidates > 0 ? 'exact' : parts.some((p) => p.kind === 'output_image') ? 'estimated' : 'estimated',
  };
}

/** @deprecated 测试与过渡兼容 */
export function usageFromGeminiMetadata(
  usage: UsageGeminiMetadata | null | undefined,
  fallbackMeterKind: 'token' | 'image' = 'token'
): {
  meterKind: 'token' | 'image';
  quantityIn: number;
  quantityOut: number;
  quantity: number;
  unit: string;
  costConfidence: 'exact' | 'estimated';
} {
  const prompt = Math.max(0, Math.floor(Number(usage?.promptTokenCount) || 0));
  const out = Math.max(0, Math.floor(Number(usage?.candidatesTokenCount) || 0));
  const total = Math.max(0, Math.floor(Number(usage?.totalTokenCount) || prompt + out));
  if (prompt > 0 || out > 0 || total > 0) {
    return {
      meterKind: 'token',
      quantityIn: prompt,
      quantityOut: out,
      quantity: total || prompt + out,
      unit: 'token',
      costConfidence: 'exact',
    };
  }
  if (fallbackMeterKind === 'image') {
    return {
      meterKind: 'image',
      quantityIn: 0,
      quantityOut: 0,
      quantity: 1,
      unit: 'image',
      costConfidence: 'estimated',
    };
  }
  return {
    meterKind: fallbackMeterKind,
    quantityIn: 0,
    quantityOut: 0,
    quantity: 0,
    unit: fallbackMeterKind,
    costConfidence: 'estimated',
  };
}
