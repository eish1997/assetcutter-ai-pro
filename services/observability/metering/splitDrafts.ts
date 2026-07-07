import type { UsageCostConfidence, UsageMeterKind } from '../../../shared/usageBilling';
import { CONSUMER_FLAT_IMAGE_BILLING } from '../../../shared/pricing/consumerPricing';
import type { MeterReading } from '../../../shared/observability/meterReading';

export type MeterSplitDraft = {
  idempotencySuffix: string;
  meterKind: UsageMeterKind;
  quantityIn: number;
  quantityOut: number;
  quantity: number;
  unit: string;
  costConfidence: 'exact' | 'estimated';
  meta: Record<string, unknown>;
  imageOutputTokens?: boolean;
};

function metaWithRawUsage(reading: MeterReading): Record<string, unknown> {
  return reading.rawUsage ? { usageMetadata: reading.rawUsage } : {};
}

/** 按 modality 将 MeterReading 拆成可幂等写入的计量草稿（供应商无关策略）。 */
export function splitMeterReadingToDrafts(reading: MeterReading): MeterSplitDraft[] {
  const metaBase = metaWithRawUsage(reading);

  if (reading.modality === 'text') {
    const inPart = reading.parts.find((p) => p.kind === 'input_token');
    const outPart = reading.parts.find((p) => p.kind === 'output_token');
    const quantityIn = inPart?.quantity ?? 0;
    const quantityOut = outPart?.quantity ?? 0;
    const total = quantityIn + quantityOut;
    return [
      {
        idempotencySuffix: '',
        meterKind: 'token',
        quantityIn,
        quantityOut,
        quantity: total,
        unit: 'token',
        costConfidence: reading.confidence,
        meta: metaBase,
      },
    ];
  }

  if (reading.modality === 'image') {
    const inPart = reading.parts.find((p) => p.kind === 'input_token');
    const outTok = reading.parts.find((p) => p.kind === 'output_token');
    const outImg = reading.parts.find((p) => p.kind === 'output_image');

    const imageQty = outImg && outImg.quantity > 0 ? outImg.quantity : 1;
    const outMeta: Record<string, unknown> = {
      ...metaBase,
      usagePart: 'output',
      outputKind: 'image',
    };

    if (CONSUMER_FLAT_IMAGE_BILLING) {
      outMeta.flatRate = true;
      if (inPart && inPart.quantity > 0) {
        outMeta.promptTokenCount = inPart.quantity;
      }
      if (outTok && outTok.quantity > 0) {
        outMeta.outputTokenCount = outTok.quantity;
      }
      return [
        {
          idempotencySuffix: '',
          meterKind: 'image',
          quantityIn: 0,
          quantityOut: 0,
          quantity: imageQty,
          unit: 'image',
          costConfidence:
            outImg && outImg.quantity > 0 ? 'estimated' : outTok ? 'exact' : 'estimated',
          meta: outMeta,
        },
      ];
    }

    const drafts: MeterSplitDraft[] = [];
    if (inPart && inPart.quantity > 0) {
      drafts.push({
        idempotencySuffix: ':in',
        meterKind: 'token',
        quantityIn: inPart.quantity,
        quantityOut: 0,
        quantity: inPart.quantity,
        unit: 'token',
        costConfidence: 'exact',
        meta: { ...metaBase, usagePart: 'input' },
      });
    }

    if (outTok && outTok.quantity > 0) {
      outMeta.outputTokenCount = outTok.quantity;
    }
    drafts.push({
      idempotencySuffix: ':out',
      meterKind: 'image',
      quantityIn: 0,
      quantityOut: 0,
      quantity: imageQty,
      unit: 'image',
      costConfidence: outImg && outImg.quantity > 0 ? 'estimated' : outTok ? 'exact' : 'estimated',
      meta: outMeta,
    });

    return drafts;
  }

  const taskPart = reading.parts.find((p) => p.kind === 'task');
  if (taskPart) {
    return [
      {
        idempotencySuffix: '',
        meterKind: 'task',
        quantityIn: 0,
        quantityOut: 0,
        quantity: taskPart.quantity,
        unit: taskPart.unit,
        costConfidence: reading.confidence,
        meta: metaBase,
      },
    ];
  }

  return [];
}
