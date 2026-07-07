import { CREDITS_PER_USD, usdEstToCredits } from '../credits';
import type { PriceCatalogEntry, UsageCostConfidence, UsageMeterKind } from '../usageBilling';
import { DEFAULT_PRICE_CATALOG } from '../usageBillingCatalog';
import { presentationForSku } from '../billingPresentation';
import { consumerTextFlatDisplayCredits } from './consumerPricing';

export { DEFAULT_PRICE_CATALOG };

/** jobKind → 可能触发的 billingSku（L1 预扣须覆盖价目表最高价） */
const GATE_BILLING_SKUS: Record<string, readonly string[]> = {
  workflow_generate_3d: ['3d.tripo.task', '3d.tencent.pro', '3d.tencent.rapid'],
  workflow_generate_video: ['video.workflow.task', 'video.jimeng.ti2v-v30-pro'],
  workflow_jimeng_image: ['image.jimeng.t2i-v40'],
  workflow_jimeng_video: ['video.jimeng.ti2v-v30-pro'],
  workflow_jimeng_digital_human: ['digital_human.jimeng.omnihuman-v10'],
  workflow_text_to_image: [
    'image.gemini.flash',
    'image.gemini.pro',
    'image.openai.gpt15',
    'image.openai.gpt2',
  ],
  workflow_image_edit: [
    'image.gemini.flash',
    'image.gemini.pro',
    'image.openai.gpt15',
    'image.openai.gpt2',
  ],
  workflow_understand: ['llm.gemini.pro', 'llm.gemini.flash'],
  workflow_chat: ['llm.gemini.pro', 'llm.gemini.flash', 'llm.openai.gpt4o', 'llm.openai.gpt4o-mini'],
};

/** token 类 jobKind 保守下限（长对话/理解） */
const GATE_TOKEN_FLOOR_CREDITS: Record<string, number> = {
  workflow_chat: 10,
  workflow_understand: 15,
};

export type PriceUsageQuoteInput = {
  billingSku: string;
  meterKind: UsageMeterKind;
  quantityIn?: number;
  quantityOut?: number;
  quantity?: number;
  imageOutputTokens?: boolean;
  byok?: boolean;
  usagePart?: 'input' | 'output';
  outputKind?: 'token' | 'image' | string;
};

export type PriceUsageQuoteResult = {
  costUsdEst: number | null;
  creditsCharge: number;
  creditsFloor: number;
  floorApplied: boolean;
  confidence: UsageCostConfidence;
};

export function findPriceCatalogEntry(
  catalog: PriceCatalogEntry[],
  billingSku: string
): PriceCatalogEntry | null {
  const sku = String(billingSku || '').trim();
  if (!sku) return null;
  return catalog.find((e) => e.billingSku === sku) ?? null;
}

/** 价目表每单位用户积分（token SKU 为单次计费保守下限，非百万 token 公示价） */
export function userCreditsPerUnit(entry: PriceCatalogEntry): number {
  if (entry.userCreditsPerUnit != null && Number.isFinite(Number(entry.userCreditsPerUnit))) {
    return Math.max(0, Math.floor(Number(entry.userCreditsPerUnit)));
  }
  if (entry.perUnit != null && Number.isFinite(entry.perUnit) && entry.perUnit > 0) {
    return Math.ceil(entry.perUnit * CREDITS_PER_USD);
  }
  const sku = String(entry.billingSku || '');
  if (sku.startsWith('llm.')) return 1;
  return 0;
}

/** 用户可见价目：C 端一口价 — 文本公示「次（起）」，生图/任务公示 perUnit */
export function publicListCreditsPerUnit(entry: PriceCatalogEntry): number {
  if (entry.userCreditsPerUnit != null && Number.isFinite(Number(entry.userCreditsPerUnit))) {
    const admin = Math.floor(Number(entry.userCreditsPerUnit));
    if (!(entry.meterKind === 'token' && admin <= 1)) {
      return Math.max(0, admin);
    }
  }
  if (entry.meterKind === 'token') {
    return consumerTextFlatDisplayCredits(entry);
  }
  return userCreditsPerUnit(entry);
}

export function estimateCostUsdForDraft(
  entry: PriceCatalogEntry | null | undefined,
  input: {
    meterKind: UsageMeterKind;
    quantityIn?: number;
    quantityOut?: number;
    quantity?: number;
    imageOutputTokens?: boolean;
  }
): number | null {
  if (!entry) return null;
  const markup = 1 + Math.max(0, Number(entry.markupPct) || 0) / 100;
  if (input.meterKind === 'token') {
    const inTok = Math.max(0, Number(input.quantityIn) || 0);
    const outTok = Math.max(0, Number(input.quantityOut) || 0);
    const inRate = Number(entry.inputPer1m);
    const useImageOutRate =
      Boolean(input.imageOutputTokens) ||
      (entry.meterKind === 'image' && outTok > 0 && inTok === 0);
    const outRate = useImageOutRate
      ? Number(entry.imageOutputPer1m ?? entry.outputPer1m)
      : Number(entry.outputPer1m);
    if (!Number.isFinite(inRate) && !Number.isFinite(outRate)) return null;
    const cost =
      (inTok / 1_000_000) * (Number.isFinite(inRate) ? inRate : 0) +
      (outTok / 1_000_000) * (Number.isFinite(outRate) ? outRate : 0);
    return Math.round(cost * markup * 1e8) / 1e8;
  }
  const per = Number(entry.perUnit);
  if (!Number.isFinite(per)) return null;
  const qty = Math.max(0, Number(input.quantity) || 0);
  return Math.round(qty * per * markup * 1e8) / 1e8;
}

function resolveImageOutputTokens(
  entry: PriceCatalogEntry,
  input: PriceUsageQuoteInput
): boolean {
  if (input.imageOutputTokens) return true;
  return (
    entry.meterKind === 'image' &&
    input.meterKind === 'token' &&
    input.usagePart === 'output' &&
    (input.outputKind === 'image' || input.outputKind === 'token')
  );
}

function hasBillableQuantity(input: PriceUsageQuoteInput): boolean {
  if (input.meterKind === 'token') {
    return (
      (Number(input.quantityIn) || 0) > 0 ||
      (Number(input.quantityOut) || 0) > 0 ||
      (Number(input.quantity) || 0) > 0
    );
  }
  return (Number(input.quantity) || 0) > 0;
}

export function priceUsageQuote(
  input: PriceUsageQuoteInput,
  catalogEntry?: PriceCatalogEntry | null
): PriceUsageQuoteResult {
  if (input.byok) {
    return {
      costUsdEst: null,
      creditsCharge: 0,
      creditsFloor: 0,
      floorApplied: false,
      confidence: 'unknown',
    };
  }

  const entry =
    catalogEntry ??
    findPriceCatalogEntry(DEFAULT_PRICE_CATALOG, input.billingSku);
  if (!entry) {
    return {
      costUsdEst: null,
      creditsCharge: 0,
      creditsFloor: 0,
      floorApplied: false,
      confidence: 'unknown',
    };
  }

  const imageOutputTokens = resolveImageOutputTokens(entry, input);
  const costUsdEst = estimateCostUsdForDraft(entry, {
    meterKind: input.meterKind,
    quantityIn: input.quantityIn,
    quantityOut: input.quantityOut,
    quantity: input.quantity,
    imageOutputTokens,
  });
  const tokenCredits = usdEstToCredits(costUsdEst);
  const unitCredits = userCreditsPerUnit(entry);

  let creditsCharge = tokenCredits;
  let creditsFloor = 0;
  let floorApplied = false;

  const isImageCatalog = entry.meterKind === 'image';
  const isImageMeterDraft =
    input.meterKind === 'image' && (Number(input.quantity) || 0) > 0;
  const isImageOutputViaToken =
    input.meterKind === 'token' &&
    input.usagePart === 'output' &&
    input.outputKind === 'image';
  const isImageOutputTokenDraft =
    input.meterKind === 'token' &&
    input.usagePart === 'output' &&
    input.outputKind === 'token';

  if (isImageCatalog && (isImageMeterDraft || isImageOutputViaToken)) {
    const qty = Math.max(1, Number(input.quantity) || 1);
    creditsFloor = unitCredits * qty;
    creditsCharge = Math.max(tokenCredits, creditsFloor);
    floorApplied = creditsCharge > tokenCredits;
  } else if (isImageCatalog && isImageOutputTokenDraft) {
    creditsFloor = unitCredits;
    creditsCharge = Math.max(tokenCredits, unitCredits);
    floorApplied = creditsCharge > tokenCredits;
  } else if (entry.billingSku.startsWith('llm.') && input.meterKind === 'token' && hasBillableQuantity(input)) {
    creditsFloor = unitCredits;
    creditsCharge = Math.max(tokenCredits, unitCredits);
    floorApplied = creditsCharge > tokenCredits;
  } else if (unitCredits > 0 && tokenCredits === 0 && hasBillableQuantity(input)) {
    creditsFloor = unitCredits;
    creditsCharge = unitCredits;
    floorApplied = true;
  }

  const confidence: UsageCostConfidence =
    costUsdEst != null ? 'estimated' : hasBillableQuantity(input) ? 'unknown' : 'unknown';

  return { costUsdEst, creditsCharge, creditsFloor, floorApplied, confidence };
}

export function quoteGateMinCreditsForJob(jobKind: string | null | undefined): number {
  const kind = String(jobKind || '').trim();
  const skus = GATE_BILLING_SKUS[kind];
  if (!skus?.length) return 1;

  let maxCredits = 0;
  for (const sku of skus) {
    const entry = findPriceCatalogEntry(DEFAULT_PRICE_CATALOG, sku);
    if (entry) maxCredits = Math.max(maxCredits, userCreditsPerUnit(entry));
  }
  const tokenFloor = GATE_TOKEN_FLOOR_CREDITS[kind] ?? 0;
  return Math.max(maxCredits, tokenFloor, 1);
}

export type PublicPriceCatalogRow = {
  billingSku: string;
  displayName: string;
  meterKind: UsageMeterKind;
  creditsPerUnit: number;
  unitLabel: string;
  category: 'text' | 'image' | '3d' | 'video' | 'other';
};

/** API / UI 价目行（与 server listPublicPriceCatalog 对齐） */
export type PublicPriceCatalogItem = PublicPriceCatalogRow & {
  capability?: string;
  model?: string;
  unit?: string;
  creditsPerUnit: number | null;
};

export type UsageQuoteStep = {
  jobKind: string;
  minCredits: number;
  label: string;
};

export function listPublicPriceCatalog(): PublicPriceCatalogRow[] {
  return DEFAULT_PRICE_CATALOG.map((entry) => {
    const presentation = presentationForSku(entry.billingSku);
    return {
      billingSku: entry.billingSku,
      displayName: presentation.label,
      meterKind: entry.meterKind,
      creditsPerUnit: publicListCreditsPerUnit(entry),
      unitLabel: presentation.unitLabel,
      category: presentation.category,
    };
  });
}
