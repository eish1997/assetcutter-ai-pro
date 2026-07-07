import type { MeterReading } from '../../../shared/observability/meterReading';
import { emitMeteredUsage } from './pipeline';

const OPENAI_PROVIDER = 'openai-official';

export function emitOpenAiMeteredUsage(args: {
  registryId: string;
  reading: MeterReading;
  requestId: string;
  jobKind?: string;
}): void {
  const registryId = String(args.registryId || '').trim();
  const requestId = String(args.requestId || '').trim();
  if (!registryId || !requestId) return;
  const prefix =
    args.reading.modality === 'image'
      ? `openai-image:${requestId}`
      : `openai-chat:${requestId}`;
  emitMeteredUsage({
    reading: { ...args.reading, provider: args.reading.provider || OPENAI_PROVIDER },
    registryId,
    idempotencyPrefix: prefix,
    requestId,
    jobKind: args.jobKind,
    extraMeta: { byok: true },
  });
}
