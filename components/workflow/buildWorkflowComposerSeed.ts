import type { CustomAppModule, CapabilitySet, CapabilitySetEdge, CapabilitySetNode } from '../../types';
import { pickCapabilityPresetPreview } from '../../services/capabilityPreviewUrl';
import { uuid } from './workflowIds';

/** 将能力 A 拖到能力 B 上打开工作流创建时的初始图：资产输入 → A → B → 输出 */
export function buildWorkflowComposerSeedFromTwoPresets(a: CustomAppModule, b: CustomAppModule): CapabilitySet {
  const setId = `set-${uuid()}`;
  const now = Date.now();
  const pidA = `preset-${a.id}-${uuid()}`;
  const pidB = `preset-${b.id}-${uuid()}`;
  const nodes: CapabilitySetNode[] = [
    { id: 'asset-input-1', type: 'assetInput', position: { x: 40, y: 140 }, data: { label: '输入资产' } },
    {
      id: pidA,
      type: 'preset',
      position: { x: 220, y: 120 },
      data: { label: a.label, presetId: a.id, previewImage: pickCapabilityPresetPreview(a) },
    },
    {
      id: pidB,
      type: 'preset',
      position: { x: 420, y: 140 },
      data: { label: b.label, presetId: b.id, previewImage: pickCapabilityPresetPreview(b) },
    },
    {
      id: 'output-1',
      type: 'output',
      position: { x: 620, y: 130 },
      data: { label: '输出', outputCategory: 'image_to_image' },
    },
  ];
  const edges: CapabilitySetEdge[] = [
    { id: `e-${uuid()}`, source: 'asset-input-1', target: pidA },
    { id: `e-${uuid()}`, source: pidA, target: pidB },
    { id: `e-${uuid()}`, source: pidB, target: 'output-1' },
  ];
  return { id: setId, label: `${a.label} → ${b.label}`, nodes, edges, createdAt: now, updatedAt: now };
}
