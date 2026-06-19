/**
 * 价目表种子 — 与 shared/usageBillingCatalog.ts 保持数值一致。
 */
export const DEFAULT_PRICE_CATALOG = [
  {
    billingSku: 'llm.gemini.flash',
    meterKind: 'token',
    inputPer1m: 0.15,
    outputPer1m: 0.6,
    displayName: 'Gemini 2.5 Flash (text)',
    vendorSkuRef: 'gemini-2.5-flash',
  },
  {
    billingSku: 'llm.gemini.pro',
    meterKind: 'token',
    inputPer1m: 1.25,
    outputPer1m: 10.0,
    displayName: 'Gemini 2.5 Pro (text)',
    vendorSkuRef: 'gemini-2.5-pro',
  },
  {
    billingSku: 'image.gemini.flash',
    meterKind: 'image',
    inputPer1m: 0.3,
    outputPer1m: 30.0,
    perUnit: 0.039,
    displayName: 'Gemini Flash Image',
    vendorSkuRef: 'gemini-2.5-flash-image',
  },
  {
    billingSku: 'image.gemini.pro',
    meterKind: 'image',
    inputPer1m: 2.0,
    outputPer1m: 12.0,
    perUnit: 0.134,
    displayName: 'Gemini Pro Image',
    vendorSkuRef: 'gemini-3-pro-image',
  },
  {
    billingSku: '3d.tripo.task',
    meterKind: 'task',
    perUnit: 0.5,
    displayName: 'Tripo 3D task (estimate)',
    vendorSkuRef: 'tripo-image-to-model',
  },
  {
    billingSku: 'video.workflow.task',
    meterKind: 'task',
    perUnit: 0.2,
    displayName: 'Workflow video task (estimate)',
  },
];

export function getPriceCatalogEntry(billingSku) {
  const sku = String(billingSku || '').trim();
  return DEFAULT_PRICE_CATALOG.find((e) => e.billingSku === sku) ?? null;
}

export function estimateCostFromCatalog(billingSku, input) {
  const entry = getPriceCatalogEntry(billingSku);
  if (!entry) return null;
  const markup = 1 + Math.max(0, Number(entry.markupPct) || 0) / 100;
  const meterKind = String(input.meterKind || entry.meterKind || '').trim();
  if (meterKind === 'token') {
    const inTok = Math.max(0, Number(input.quantityIn) || 0);
    const outTok = Math.max(0, Number(input.quantityOut) || 0);
    const inRate = Number(entry.inputPer1m);
    const outRate = Number(entry.outputPer1m);
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
