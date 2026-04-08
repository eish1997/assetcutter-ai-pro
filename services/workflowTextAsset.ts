import type { CustomAppModule, WorkflowAsset } from '../types';

/** 单张文字资产正文上限（字符），防止工作区 JSON 过大 */
export const WORKFLOW_TEXT_ASSET_BODY_MAX_CHARS = 32_000;

export function isWorkflowTextAsset(a: WorkflowAsset): boolean {
  return a.assetKind === 'text';
}

export function clampWorkflowTextBody(raw: string): string {
  if (raw.length <= WORKFLOW_TEXT_ASSET_BODY_MAX_CHARS) return raw;
  return raw.slice(0, WORKFLOW_TEXT_ASSET_BODY_MAX_CHARS);
}

/** 文字卡拖入能力时拼接为 inputText */
export function workflowAssetToInputText(a: WorkflowAsset): string {
  const t = (a.textTitle || '').trim();
  const b = (a.textBody || '').trim();
  if (t && b) return `${t}\n\n${b}`;
  return b || t;
}

/** 文字卡可拖入：文生文、文生图 */
export function workflowPresetAcceptsTextCardDrag(mod: CustomAppModule): boolean {
  return mod.category === 'text_to_text' || mod.category === 'text_to_image';
}

/** 根资产拖入某预设时是否允许（按输入格式匹配资产类型） */
export function workflowAssetAllowedForCapabilityDrop(asset: WorkflowAsset, mod: CustomAppModule): boolean {
  if (mod.category === 'generate_3d') return !isWorkflowTextAsset(asset);
  if (isWorkflowTextAsset(asset)) return workflowPresetAcceptsTextCardDrag(mod);
  return mod.category === 'image_to_image' || mod.category === 'image_to_text';
}

export function workflowTextAssetOutlineLabel(a: WorkflowAsset): string {
  const t = a.textTitle?.trim();
  if (t) return t.length > 32 ? `${t.slice(0, 32)}…` : t;
  const b = a.textBody?.trim();
  if (b) {
    const line = b.split(/\r?\n/).find((x) => x.trim()) ?? b;
    const s = line.trim().slice(0, 24);
    return s.length < line.trim().length ? `${s}…` : s || '文字';
  }
  return '文字';
}
