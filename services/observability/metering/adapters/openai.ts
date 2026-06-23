import type { MeterModality, MeterPart, MeterReading } from '../../../../shared/observability/meterReading';
import { isLikelyImageRegistryId } from '../resolveBillingSku';

type OpenAiChatUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

type OpenAiImageUsage = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_tokens_details?: {
    text_tokens?: number;
    image_tokens?: number;
  };
};

function num(v: unknown): number {
  return Math.max(0, Math.floor(Number(v) || 0));
}

export function parseOpenAiChatUsage(raw: unknown): OpenAiChatUsage | null {
  const usage = (raw as { usage?: OpenAiChatUsage } | null | undefined)?.usage;
  if (!usage || typeof usage !== 'object') return null;
  return usage;
}

export function parseOpenAiImageUsage(raw: unknown): OpenAiImageUsage | null {
  const usage = (raw as { usage?: OpenAiImageUsage } | null | undefined)?.usage;
  if (!usage || typeof usage !== 'object') return null;
  return usage;
}

export function meterReadingFromOpenAiChat(args: {
  registryId: string;
  provider: string;
  raw: unknown;
}): MeterReading {
  const usage = parseOpenAiChatUsage(args.raw);
  const prompt = num(usage?.prompt_tokens);
  const completion = num(usage?.completion_tokens);
  const parts: MeterPart[] = [];
  if (prompt > 0) parts.push({ kind: 'input_token', quantity: prompt, unit: 'token' });
  if (completion > 0) parts.push({ kind: 'output_token', quantity: completion, unit: 'token' });
  return {
    provider: args.provider,
    modality: 'text',
    parts,
    rawUsage: usage ?? undefined,
    confidence: prompt > 0 || completion > 0 ? 'exact' : 'estimated',
  };
}

export function meterReadingFromOpenAiImage(args: {
  registryId: string;
  provider: string;
  raw: unknown;
  generatedImage: boolean;
}): MeterReading {
  const usage = parseOpenAiImageUsage(args.raw);
  const inputTok = num(usage?.input_tokens);
  const outputTok = num(usage?.output_tokens);
  const parts: MeterPart[] = [];

  if (inputTok > 0) parts.push({ kind: 'input_token', quantity: inputTok, unit: 'token' });
  if (outputTok > 0) {
    parts.push({ kind: 'output_token', quantity: outputTok, unit: 'token' });
  } else if (args.generatedImage) {
    parts.push({ kind: 'output_image', quantity: 1, unit: 'image' });
  }

  return {
    provider: args.provider,
    modality: 'image',
    parts,
    rawUsage: usage ?? undefined,
    confidence:
      inputTok > 0 || outputTok > 0 ? 'exact' : args.generatedImage ? 'estimated' : 'estimated',
  };
}

export function openAiModalityForRegistry(registryId: string): MeterModality {
  return isLikelyImageRegistryId(registryId) ? 'image' : 'text';
}

export function newOpenAiRequestId(): string {
  return `oai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
