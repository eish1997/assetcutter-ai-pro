import type { UsageGeminiMetadata } from '../../../shared/usageBilling';
import { extractUsageMetadata } from '../../../shared/extractUsageMetadata.js';
import { peekCorrelationContext } from '../correlationContext';
import { emitMeteredUsage } from './pipeline';
import { meterReadingFromGeminiProxy } from './adapters/gemini';
import { isLikelyImageRegistryId } from './resolveBillingSku';

export type GeminiChannelProvider = 'toapis' | 'vectorengine';

/** 调用方通过 config 传入站内 registryId，避免计量误用上游 model id */
export const METERING_REGISTRY_ID_KEY = '__meteringRegistryId';

/** OpenAI 兼容流式末包 usage，由 toapis/openai adapter 附加 */
export const OPENAI_STREAM_USAGE_KEY = '__openAiStreamUsage';

function newChannelRequestId(provider: GeminiChannelProvider): string {
  return `${provider}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function resolveMeteringRegistryId(args: {
  model: string;
  config?: Record<string, unknown>;
}): string {
  const fromConfig = String(args.config?.[METERING_REGISTRY_ID_KEY] || '').trim();
  if (fromConfig) return fromConfig;
  const fromCtx = peekCorrelationContext().registryId?.trim();
  if (fromCtx) return fromCtx;
  return String(args.model || '').trim();
}

export function stripMeteringConfigKeys(
  config?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!config || !(METERING_REGISTRY_ID_KEY in config)) return config;
  const next = { ...config };
  delete next[METERING_REGISTRY_ID_KEY];
  return next;
}

function usageMetadataFromGeminiLikeResponse(response: unknown): UsageGeminiMetadata | null {
  if (!response || typeof response !== 'object') return null;
  const raw = response as { usageMetadata?: UsageGeminiMetadata };
  if (raw.usageMetadata) return raw.usageMetadata;
  return extractUsageMetadata(response);
}

function usageFromStreamChunk(chunk: unknown): UsageGeminiMetadata | null {
  const direct = usageMetadataFromGeminiLikeResponse(chunk);
  if (direct) return direct;
  if (!chunk || typeof chunk !== 'object') return null;
  const raw = chunk as {
    [OPENAI_STREAM_USAGE_KEY]?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };
  const u = raw[OPENAI_STREAM_USAGE_KEY];
  if (!u || typeof u !== 'object') return null;
  const prompt = Math.max(0, Math.floor(Number(u.prompt_tokens) || 0));
  const candidates = Math.max(0, Math.floor(Number(u.completion_tokens) || 0));
  const total = Math.max(0, Math.floor(Number(u.total_tokens) || prompt + candidates));
  if (!prompt && !candidates && !total) return null;
  return { promptTokenCount: prompt, candidatesTokenCount: candidates, totalTokenCount: total };
}

/** ToAPIs / VectorEngine 等 Gemini 形态第三方通道的统一计量出口 */
export function emitGeminiChannelMeteredUsage(args: {
  provider: GeminiChannelProvider;
  registryId: string;
  response: unknown;
  jobKind?: string;
  requestId?: string;
  stream?: boolean;
}): void {
  const registryId = String(args.registryId || '').trim();
  if (!registryId) return;
  const requestId = String(args.requestId || '').trim() || newChannelRequestId(args.provider);
  const imageRole = isLikelyImageRegistryId(registryId);
  const streamTag = args.stream ? '-stream' : '';
  emitMeteredUsage({
    reading: meterReadingFromGeminiProxy({
      registryId,
      provider: args.provider,
      usageMetadata: usageMetadataFromGeminiLikeResponse(args.response),
      proxyResult: args.response,
    }),
    registryId,
    idempotencyPrefix: `${args.provider}${streamTag}:${requestId}`,
    requestId,
    jobKind: args.jobKind ?? (imageRole ? 'workflow_image' : 'workflow_chat'),
    extraMeta: { byok: true },
  });
}

export type GeminiClientLike = {
  models: {
    generateContent: (args: {
      model: string;
      contents: unknown;
      config?: Record<string, unknown>;
    }) => Promise<unknown>;
    generateContentStream?: (args: {
      model: string;
      contents: unknown;
      config?: Record<string, unknown>;
    }) => AsyncIterable<unknown>;
  };
};

export function wrapGeminiClientWithChannelMetering(
  client: GeminiClientLike,
  provider: GeminiChannelProvider
): GeminiClientLike {
  return {
    models: {
      async generateContent(args) {
        const registryId = resolveMeteringRegistryId(args);
        const config = stripMeteringConfigKeys(args.config);
        const result = await client.models.generateContent({ ...args, config });
        emitGeminiChannelMeteredUsage({
          provider,
          registryId,
          response: result,
          jobKind: isLikelyImageRegistryId(registryId) ? 'workflow_image' : 'workflow_chat',
        });
        return result;
      },
      ...(client.models.generateContentStream
        ? {
            async *generateContentStream(args) {
              const registryId = resolveMeteringRegistryId(args);
              const config = stripMeteringConfigKeys(args.config);
              const requestId = newChannelRequestId(provider);
              let lastUsage: UsageGeminiMetadata | null = null;
              let lastUsageCarrier: unknown = null;
              const stream = client.models.generateContentStream!({ ...args, config });
              for await (const chunk of stream) {
                const usage = usageFromStreamChunk(chunk);
                if (usage) {
                  lastUsage = usage;
                  lastUsageCarrier = chunk;
                }
                yield chunk;
              }
              emitGeminiChannelMeteredUsage({
                provider,
                registryId,
                response: lastUsageCarrier ?? { usageMetadata: lastUsage ?? undefined },
                jobKind: isLikelyImageRegistryId(registryId) ? 'workflow_image' : 'workflow_chat',
                requestId,
                stream: true,
              });
            },
          }
        : {}),
    },
  };
}
