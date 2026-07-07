/**
 * Node ESM mirror of shared/pricing/pricingEngine.ts — 数值须与 TS 侧一致。
 * 纯定价逻辑；读模型见 pricing-read-model.js（避免与 credit-store 循环引用）。
 */
import { usdEstToCredits, CREDITS_PER_USD } from './credits-math.js';
import { DEFAULT_PRICE_CATALOG } from './usage-price-catalog.js';
import { listActiveCatalogSync, toPricingCatalogEntry } from './price-catalog-store.js';

export { DEFAULT_PRICE_CATALOG };

function getRuntimeCatalog() {
  const active = listActiveCatalogSync();
  if (active.length > 0) {
    return active.map((e) => toPricingCatalogEntry(e)).filter(Boolean);
  }
  return DEFAULT_PRICE_CATALOG;
}

const CATEGORY_LABELS = {
  text: '文本',
  image: '图片',
  '3d': '3D',
  video: '视频',
  other: 'AI',
};

const JOB_KIND_LABELS = {
  workflow_understand: '工作流 · 理解',
  workflow_text_to_image: '工作流 · 生图',
  workflow_image_edit: '工作流 · 改图',
  workflow_chat: '工作流 · 对话',
  workflow_generate_3d: '工作流 · 3D',
  workflow_generate_video: '工作流 · 视频',
  workflow_jimeng_image: '即梦 · 生图',
  workflow_jimeng_video: '即梦 · 视频',
  workflow_jimeng_digital_human: '即梦 · 数字人',
};

const GATE_TOKEN_FLOOR_CREDITS = {
  workflow_chat: 10,
  workflow_understand: 15,
};

/** jobKind → 可能触发的 billingSku（L1 预扣须覆盖价目表最高价） */
const GATE_BILLING_SKUS = {
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

const SKU_PRESENTATION = {
  'llm.gemini.flash': { label: 'Gemini 2.5 Flash 文本', unitLabel: '次', category: 'text' },
  'llm.gemini.pro': { label: 'Gemini 2.5 Pro 文本', unitLabel: '次', category: 'text' },
  'llm.openai.gpt4o-mini': { label: 'GPT-4o Mini 文本', unitLabel: '次', category: 'text' },
  'llm.openai.gpt4o': { label: 'GPT-4o 文本', unitLabel: '次', category: 'text' },
  'image.gemini.flash': { label: 'Gemini Flash 生图', unitLabel: '张', category: 'image' },
  'image.gemini.pro': { label: 'Gemini Pro 生图', unitLabel: '张', category: 'image' },
  'image.openai.gpt15': { label: 'GPT Image 1.5', unitLabel: '张', category: 'image' },
  'image.openai.gpt2': { label: 'GPT Image 2', unitLabel: '张', category: 'image' },
  'image.jimeng.t2i-v40': { label: '即梦 图片 4.0', unitLabel: '次', category: 'image' },
  '3d.tripo.task': { label: 'Tripo 3D 生成', unitLabel: '次', category: '3d' },
  '3d.tencent.pro': { label: '腾讯混元 3D 专业版', unitLabel: '次', category: '3d' },
  '3d.tencent.rapid': { label: '腾讯混元 3D 极速版', unitLabel: '次', category: '3d' },
  'video.workflow.task': { label: '工作流视频任务', unitLabel: '次', category: 'video' },
  'video.jimeng.ti2v-v30-pro': { label: '即梦 视频 3.0 Pro', unitLabel: '次', category: 'video' },
  'digital_human.jimeng.omnihuman-v10': {
    label: '即梦 OmniHuman 1.0',
    unitLabel: '次',
    category: 'video',
  },
};

function categoryFromSku(sku) {
  if (sku.startsWith('llm.')) return 'text';
  if (sku.startsWith('image.')) return 'image';
  if (sku.startsWith('3d.')) return '3d';
  if (sku.startsWith('video.') || sku.startsWith('digital_human.')) return 'video';
  return 'other';
}

function consumerPublicUnitLabel(entry, baseUnitLabel) {
  if (entry.meterKind === 'image' || entry.meterKind === 'task') {
    return baseUnitLabel.includes('一口价') ? baseUnitLabel : `${baseUnitLabel}（一口价）`;
  }
  if (entry.meterKind === 'token') {
    return baseUnitLabel.includes('起') ? baseUnitLabel : `${baseUnitLabel}（起）`;
  }
  return baseUnitLabel;
}

function consumerTextFlatDisplayCredits(entry) {
  const sku = String(entry.billingSku || '');
  if (sku.includes('.pro') || (sku.includes('gpt4o') && !sku.includes('mini'))) {
    return 15;
  }
  return 10;
}

function presentationForSku(billingSku) {
  const sku = String(billingSku || '').trim();
  const override = SKU_PRESENTATION[sku];
  const entry = getRuntimeCatalog().find((e) => e.billingSku === sku);
  const category = override?.category ?? categoryFromSku(sku);
  const baseUnit =
    override?.unitLabel ??
    (entry?.meterKind === 'token' ? '次' : entry?.meterKind === 'image' ? '张' : '次');
  const unitLabel = consumerPublicUnitLabel(
    { meterKind: entry?.meterKind ?? 'task', billingSku: sku },
    baseUnit
  );
  if (override) {
    return { label: override.label, unitLabel, category };
  }
  return {
    label: entry?.displayName ?? sku,
    unitLabel,
    category,
  };
}

export function findPriceCatalogEntry(catalog, billingSku) {
  const sku = String(billingSku || '').trim();
  if (!sku) return null;
  return catalog.find((e) => e.billingSku === sku) ?? null;
}

export function userCreditsPerUnit(entry) {
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
export function publicListCreditsPerUnit(entry) {
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

export function estimateCostUsdForDraft(entry, input) {
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

function resolveImageOutputTokens(entry, input) {
  if (input.imageOutputTokens) return true;
  return (
    entry.meterKind === 'image' &&
    input.meterKind === 'token' &&
    input.usagePart === 'output' &&
    (input.outputKind === 'image' || input.outputKind === 'token')
  );
}

function hasBillableQuantity(input) {
  if (input.meterKind === 'token') {
    return (
      (Number(input.quantityIn) || 0) > 0 ||
      (Number(input.quantityOut) || 0) > 0 ||
      (Number(input.quantity) || 0) > 0
    );
  }
  return (Number(input.quantity) || 0) > 0;
}

export function priceUsageQuote(input, catalogEntry) {
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
    catalogEntry ?? findPriceCatalogEntry(getRuntimeCatalog(), input.billingSku);
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
  const isImageMeterDraft = input.meterKind === 'image' && (Number(input.quantity) || 0) > 0;
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

  const confidence = costUsdEst != null ? 'estimated' : 'unknown';

  return { costUsdEst, creditsCharge, creditsFloor, floorApplied, confidence };
}

export function quoteGateMinCreditsForJob(jobKind) {
  const kind = String(jobKind || '').trim();
  const skus = GATE_BILLING_SKUS[kind];
  if (!skus?.length) return 1;

  let maxCredits = 0;
  for (const sku of skus) {
    const entry = findPriceCatalogEntry(getRuntimeCatalog(), sku);
    if (entry) maxCredits = Math.max(maxCredits, userCreditsPerUnit(entry));
  }
  const tokenFloor = GATE_TOKEN_FLOOR_CREDITS[kind] ?? 0;
  return Math.max(maxCredits, tokenFloor, 1);
}

export function listPublicPriceCatalog() {
  return getRuntimeCatalog().map((entry) => {
    const presentation = presentationForSku(entry.billingSku);
    const credits = publicListCreditsPerUnit(entry);
    return {
      billingSku: entry.billingSku,
      capability: CATEGORY_LABELS[presentation.category] || 'AI',
      model: presentation.label,
      creditsPerUnit: credits > 0 ? credits : null,
      unit: presentation.unitLabel,
      meterKind: entry.meterKind,
      displayName: presentation.label,
      unitLabel: presentation.unitLabel,
      category: presentation.category,
    };
  });
}
