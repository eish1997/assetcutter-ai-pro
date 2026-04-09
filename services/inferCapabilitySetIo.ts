import type { CustomAppModule, CapabilityCategory } from '../types';

/** 画布推断用最小节点结构（与 React Flow / CapabilitySetNode 兼容） */
export type CapabilityGraphNodeLite = {
  id: string;
  type: string;
  data: { presetId?: string; label?: string; [key: string]: unknown };
};

export type CapabilityGraphEdgeLite = { source: string; target: string };

/** 该分类在工作流中期望主输入资产为文字卡还是图片卡 */
export function categoryExpectsTextInput(cat: CapabilityCategory): boolean {
  return cat === 'text_to_text' || cat === 'text_to_image';
}

/** 该分类节点执行后的主产物在工作流语义下为文字还是图片 */
export function categoryProducesTextOutput(cat: CapabilityCategory): boolean {
  return cat === 'text_to_text' || cat === 'image_to_text';
}

/**
 * 根据输入节点**直接连出**的预设，推断工作流应拖入文字卡还是图片卡。
 * 无连线或仅连到非预设：返回 null（UI 默认按图片）。
 * 多分支混用：任一路需要图入则视为图片优先。
 */
/** 沿出边穿过 testStop，直到非 testStop 节点 */
function walkForwardThroughTestStop(
  nodeId: string,
  edges: CapabilityGraphEdgeLite[],
  byId: Map<string, CapabilityGraphNodeLite>
): string[] {
  const n = byId.get(nodeId);
  if (!n) return [];
  if (n.type !== 'testStop') return [nodeId];
  const next = edges.filter((e) => e.source === nodeId).map((e) => e.target);
  const out: string[] = [];
  for (const t of next) out.push(...walkForwardThroughTestStop(t, edges, byId));
  return out;
}

/** 沿入边穿过 testStop，直到非 testStop 节点 */
function walkBackwardThroughTestStop(
  nodeId: string,
  edges: CapabilityGraphEdgeLite[],
  byId: Map<string, CapabilityGraphNodeLite>
): string[] {
  const n = byId.get(nodeId);
  if (!n) return [];
  if (n.type !== 'testStop') return [nodeId];
  const preds = edges.filter((e) => e.target === nodeId).map((e) => e.source);
  const out: string[] = [];
  for (const p of preds) out.push(...walkBackwardThroughTestStop(p, edges, byId));
  return out;
}

export function inferInputWorkflowMedia(
  inputId: string,
  edges: CapabilityGraphEdgeLite[],
  nodes: CapabilityGraphNodeLite[],
  presetsById: Map<string, CustomAppModule>
): 'text' | 'image' | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const direct = edges.filter((e) => e.source === inputId).map((e) => e.target);
  const targets: string[] = [];
  for (const t of direct) targets.push(...walkForwardThroughTestStop(t, edges, byId));
  if (targets.length === 0) return null;

  let anyImage = false;
  let anyText = false;

  for (const tid of targets) {
    const tn = byId.get(tid);
    if (!tn || tn.type !== 'preset') continue;
    const pid = tn.data.presetId;
    const preset = pid ? presetsById.get(pid) : undefined;
    const cat = preset?.category;
    if (!cat) continue;
    if (categoryExpectsTextInput(cat)) anyText = true;
    else anyImage = true;
  }

  if (!anyImage && !anyText) return null;
  if (anyImage) return 'image';
  return 'text';
}

/**
 * 输出节点**直接上游**为预设时，取该预设分类作为产物类型依据；
 * 用于持久化 outputCategory 与 UI。
 */
export function inferUpstreamPresetCategory(
  outputId: string,
  edges: CapabilityGraphEdgeLite[],
  nodes: CapabilityGraphNodeLite[],
  presetsById: Map<string, CustomAppModule>
): CapabilityCategory | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const directPreds = edges.filter((e) => e.target === outputId).map((e) => e.source);
  const sources: string[] = [];
  for (const s of directPreds) sources.push(...walkBackwardThroughTestStop(s, edges, byId));
  if (sources.length === 0) return null;
  for (const sid of sources) {
    const sn = byId.get(sid);
    if (!sn || sn.type !== 'preset') continue;
    const pid = sn.data.presetId;
    const preset = pid ? presetsById.get(pid) : undefined;
    if (preset?.category) return preset.category;
  }
  return null;
}

export function inferOutputWorkflowMedia(
  outputId: string,
  edges: CapabilityGraphEdgeLite[],
  nodes: CapabilityGraphNodeLite[],
  presetsById: Map<string, CustomAppModule>
): 'text' | 'image' | null {
  const cat = inferUpstreamPresetCategory(outputId, edges, nodes, presetsById);
  if (!cat) return null;
  return categoryProducesTextOutput(cat) ? 'text' : 'image';
}
