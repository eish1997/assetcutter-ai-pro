import type { PriceCatalogEntry } from './usageBilling';

/** 官方公示价近似值（USD）；Phase 0 无 markup。 */
export const DEFAULT_PRICE_CATALOG: PriceCatalogEntry[] = [
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
