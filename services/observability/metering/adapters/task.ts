import type { MeterModality, MeterReading } from '../../../../shared/observability/meterReading';

export function meterReadingFromTask(args: {
  provider: string;
  modality: Extract<MeterModality, '3d' | 'video' | 'task'>;
  quantity?: number;
  confidence?: 'exact' | 'estimated';
}): MeterReading {
  const quantity = Math.max(1, Math.floor(Number(args.quantity) || 1));
  return {
    provider: args.provider,
    modality: args.modality,
    parts: [{ kind: 'task', quantity, unit: 'task' }],
    confidence: args.confidence ?? 'estimated',
  };
}
