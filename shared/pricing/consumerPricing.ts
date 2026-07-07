import type { PriceCatalogEntry } from '../usageBilling';

/** 生图计量：仅写一条 image 事件，提示词 token 记入 meta，不向用户单独扣输入 token */
export const CONSUMER_FLAT_IMAGE_BILLING = true;

/** 与 pricingEngine GATE_TOKEN_FLOOR_CREDITS 对齐 */
const CONSUMER_TEXT_FLAT_FLASH = 10;
const CONSUMER_TEXT_FLAT_PRO = 15;

/** C 端价目：文本类公示为「次（起）」最低积分（实扣仍按 token，不低于预扣门槛） */
export function consumerTextFlatDisplayCredits(entry: PriceCatalogEntry): number {
  const sku = String(entry.billingSku || '');
  if (sku.includes('.pro') || (sku.includes('gpt4o') && !sku.includes('mini'))) {
    return CONSUMER_TEXT_FLAT_PRO;
  }
  return CONSUMER_TEXT_FLAT_FLASH;
}

export function consumerPublicUnitLabel(
  entry: Pick<PriceCatalogEntry, 'meterKind' | 'billingSku'>,
  baseUnitLabel: string
): string {
  if (entry.meterKind === 'image') {
    return baseUnitLabel.includes('一口价') ? baseUnitLabel : `${baseUnitLabel}（一口价）`;
  }
  if (entry.meterKind === 'task') {
    return baseUnitLabel.includes('一口价') ? baseUnitLabel : `${baseUnitLabel}（一口价）`;
  }
  if (entry.meterKind === 'token') {
    return baseUnitLabel.includes('起') ? baseUnitLabel : `${baseUnitLabel}（起）`;
  }
  return baseUnitLabel;
}
