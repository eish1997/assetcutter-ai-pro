import { DEFAULT_PRICE_CATALOG } from './usageBillingCatalog';
import { consumerPublicUnitLabel } from './pricing/consumerPricing';

export type BillingPresentationCategory = 'text' | 'image' | '3d' | 'video' | 'other';

export type BillingPresentation = {
  label: string;
  unitLabel: string;
  category: BillingPresentationCategory;
};

const SKU_OVERRIDES: Record<string, Partial<BillingPresentation>> = {
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

function categoryFromSku(sku: string): BillingPresentationCategory {
  if (sku.startsWith('llm.')) return 'text';
  if (sku.startsWith('image.')) return 'image';
  if (sku.startsWith('3d.')) return '3d';
  if (sku.startsWith('video.') || sku.startsWith('digital_human.')) return 'video';
  return 'other';
}

function unitLabelForMeterKind(meterKind: string | undefined, category: BillingPresentationCategory): string {
  if (meterKind === 'token') return '百万 token（输入）';
  if (meterKind === 'image') return '张';
  if (meterKind === 'second') return '秒';
  if (category === '3d' || category === 'video') return '次';
  if (meterKind === 'task') return '次';
  return '单位';
}

export function presentationForSku(billingSku: string): BillingPresentation {
  const sku = String(billingSku || '').trim();
  const override = SKU_OVERRIDES[sku];
  if (override?.label && override?.unitLabel && override?.category) {
    const entry = DEFAULT_PRICE_CATALOG.find((e) => e.billingSku === sku);
    return {
      label: override.label,
      unitLabel: consumerPublicUnitLabel(
        { meterKind: entry?.meterKind ?? 'task', billingSku: sku },
        override.unitLabel
      ),
      category: override.category,
    };
  }

  const entry = DEFAULT_PRICE_CATALOG.find((e) => e.billingSku === sku);
  const category = override?.category ?? categoryFromSku(sku);
  const label = override?.label ?? entry?.displayName ?? sku;
  const unitLabel = consumerPublicUnitLabel(
    { meterKind: entry?.meterKind ?? 'task', billingSku: sku },
    override?.unitLabel ?? unitLabelForMeterKind(entry?.meterKind, category)
  );

  return { label, unitLabel, category };
}

/** 用量流水行展示名（含 input/output/BYOK 后缀） */
export function presentationLabelForEvent(ev: {
  billingSku?: string;
  meta?: Record<string, unknown> | null;
}): string {
  const sku = String(ev.billingSku || '').trim();
  if (!sku) return '—';
  const base = presentationForSku(sku).label;
  const meta = ev.meta;
  if (meta?.byok === true) return `${base}（自备 Key）`;
  if (meta?.usagePart === 'input') return `${base} · 输入`;
  if (meta?.usagePart === 'output') return `${base} · 输出`;
  return base;
}
