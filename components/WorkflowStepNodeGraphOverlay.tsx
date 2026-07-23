import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { WorkflowAsset } from '../types';
import type { ImageVersion, VgpAssetExtension } from '../types/vgp';
import { ensureWorkflowAssetVgp } from '../services/vgp/migrateLegacyAsset';
import { previewSrcCacheFingerprint } from '../services/workflowImageThumb';
import {
  workflowVersionTextThumbLines,
} from '../services/workflowTextAsset';
import { resolveParentVersionIdForInput } from '../services/vgp/vgpStore';
import { WorkflowGridImage } from './ProgressivePreviewImage';
import { AssetCardPreviewRenderer } from './workflow/AssetCardPreviewRenderer';
import WorkflowVersionTextThumbCell from './workflow/WorkflowVersionTextThumbCell';
import WorkflowPixelBusyOverlay from './WorkflowPixelBusyOverlay';
import { resolveVersionImageSrc } from './WorkflowGenerationRecordPanel';
import { resolveWorkflowStepModelCompanionKeys, resolveWorkflowStepModelUrls } from '../services/workflowStepModels';
import {
  WORKFLOW_MODEL_PBR_SLOTS,
  type WorkflowModelPbrEditDoc,
  type WorkflowModelPbrTextureLineage,
  type WorkflowModelPbrSlot,
} from '../services/workflowModelPbrEdits';

const NODE = 52;
const TEXTURE_NODE = 38;
const TEXTURE_NODE_GAP_X = 12;
const TEXTURE_NODE_GAP_Y = 6;
/** 自上而下树：叶子子树之间的水平间距 */
const H_LEAF_GAP = 14;
/** 层与层之间的垂直步进（含节点） */
const V_LEVEL = NODE + 16;
const PAD_X = 12;
const PAD_Y = 8;
const Z_OVERLAY = 2300;
const VIEW_MARGIN = 8;
const WORKFLOW_PREVIEW_CANVAS_MODE_TOGGLE_EVENT = 'asset-preview:canvas-mode-toggle';
/** 图形容器最大高度，避免整卡过高被夹到视口底部；略抬高以容纳更深步骤树 */

type Pos = { x: number; y: number };
type CanvasView = { x: number; y: number; zoom: number };
type SelectionBox = { startX: number; startY: number; currentX: number; currentY: number };
export type WorkflowStepNodeGraphMenuAction =
  | 'add-to-input'
  | 'copy-original'
  | 'copy-id'
  | 'open-folder'
  | 'show-current';
export type WorkflowStepNodeGraphNodeContext =
  | { kind: 'version'; nodeId: string; versionId: string; displayKey: string }
  | { kind: 'texture'; nodeId: string; textureId: string; src: string; slots: WorkflowModelPbrSlot[]; materialIds?: string[]; label?: string };
type NodeContextMenu = {
  x: number;
  y: number;
  node: WorkflowStepNodeGraphNodeContext;
};
type PbrTextureInputNode = {
  id: string;
  src: string;
  label: string;
  title: string;
  slots: WorkflowModelPbrSlot[];
  materialIds: string[];
};
type PbrTextureRewriteNode = {
  id: string;
  sourceSrc: string;
  resultSrc: string;
  label: string;
  title: string;
  slots: WorkflowModelPbrSlot[];
  materialIds: string[];
};

const PBR_TEXTURE_NODE_LABELS: Record<WorkflowModelPbrSlot, string> = {
  baseColor: 'Base',
  normal: 'Normal',
  ao: 'AO',
  roughness: 'Rough',
  metallic: 'Metal',
  emissive: 'Emit',
  alpha: 'Alpha',
  height: 'Height',
};

const PBR_TEXTURE_SLOT_PRIORITY: WorkflowModelPbrSlot[] = [
  'baseColor',
  'normal',
  'ao',
  'roughness',
  'metallic',
  'emissive',
  'alpha',
  'height',
];

function collectPbrTextureInputNodes(doc: WorkflowModelPbrEditDoc | null | undefined): PbrTextureInputNode[] {
  if (!doc?.materials) return [];
  const bySrc = new Map<string, { src: string; fileName: string; slots: Set<WorkflowModelPbrSlot>; materialIds: Set<string>; updatedAt: number }>();
  for (const [materialId, material] of Object.entries(doc.materials)) {
    for (const slot of WORKFLOW_MODEL_PBR_SLOTS) {
      const edit = material.slots?.[slot];
      const src = String(edit?.dataUrl || '').trim();
      if (!edit?.enabled || !src) continue;
      const item = bySrc.get(src) || {
        src,
        fileName: String(edit.fileName || '').trim() || 'texture',
        slots: new Set<WorkflowModelPbrSlot>(),
        materialIds: new Set<string>(),
        updatedAt: Number(edit.updatedAt) || 0,
      };
      item.slots.add(slot);
      item.materialIds.add(materialId);
      item.updatedAt = Math.max(item.updatedAt, Number(edit.updatedAt) || 0);
      if (!item.fileName || item.fileName === 'texture') item.fileName = String(edit.fileName || '').trim() || item.fileName;
      bySrc.set(src, item);
    }
  }
  return Array.from(bySrc.values())
    .sort((a, b) => b.updatedAt - a.updatedAt || a.fileName.localeCompare(b.fileName))
    .map((item, index) => {
      const slots = PBR_TEXTURE_SLOT_PRIORITY.filter((slot) => item.slots.has(slot));
      const hasOrm = item.slots.has('ao') && item.slots.has('roughness') && item.slots.has('metallic');
      const label = hasOrm ? 'ORM' : PBR_TEXTURE_NODE_LABELS[slots[0] || 'baseColor'];
      const titleSlots = slots.map((slot) => PBR_TEXTURE_NODE_LABELS[slot]).join(' / ');
      return {
        id: `pbr-texture-${index}`,
        src: item.src,
        label,
        title: `${item.fileName}${titleSlots ? ` - ${titleSlots}` : ''}`,
        slots,
        materialIds: Array.from(item.materialIds),
      };
    });
}

function collectPbrTextureRewriteNodes(lineage: WorkflowModelPbrTextureLineage[] | null | undefined): PbrTextureRewriteNode[] {
  const list = Array.isArray(lineage) ? lineage : [];
  return list
    .filter((item) => String(item.sourceTextureSrc || '').trim() && String(item.resultTextureSrc || '').trim())
    .slice(-24)
    .map((item, index) => ({
      id: `pbr-rewrite-${item.id || index}`,
      sourceSrc: item.sourceTextureSrc,
      resultSrc: item.resultTextureSrc,
      label: item.textureLabel || 'Regen',
      title: `${item.textureLabel || 'Texture'} -> ${item.actionType}`,
      slots: item.slots || [],
      materialIds: item.materialIds || [],
    }));
}

function layoutVersionGraph(vgp: VgpAssetExtension): {
  positions: Record<string, Pos>;
  width: number;
  height: number;
} {
  const { versionOrder, versionsById } = vgp;
  const ids = new Set(versionOrder);

  function effParent(v: ImageVersion): string | null {
    const p = v.parentVersionId;
    return p && ids.has(p) ? p : null;
  }

  const childrenMap = new Map<string | null, ImageVersion[]>();
  for (const id of versionOrder) {
    const v = versionsById[id];
    if (!v) continue;
    const ep = effParent(v);
    if (!childrenMap.has(ep)) childrenMap.set(ep, []);
    childrenMap.get(ep)!.push(v);
  }
  for (const arr of childrenMap.values()) {
    arr.sort((a, b) => a.stepIndex - b.stepIndex || a.createdAt - b.createdAt);
  }

  const roots = [...(childrenMap.get(null) ?? [])];
  roots.sort((a, b) => a.stepIndex - b.stepIndex || a.createdAt - b.createdAt);
  const positions: Record<string, Pos> = {};

  if (roots.length === 0) {
    const sorted = versionOrder
      .map((id) => versionsById[id])
      .filter(Boolean) as ImageVersion[];
    sorted.sort((a, b) => a.stepIndex - b.stepIndex || a.createdAt - b.createdAt);
    let y = PAD_Y;
    const maxR = PAD_X + NODE;
    for (const v of sorted) {
      positions[v.id] = { x: PAD_X, y };
      y += V_LEVEL;
    }
    const maxB = sorted.length === 0 ? PAD_Y + NODE + PAD_Y : y - (V_LEVEL - NODE) + PAD_Y;
    return {
      positions,
      width: maxR + PAD_X,
      height: Math.max(PAD_Y * 2 + NODE, maxB),
    };
  }

  let nextLeafX = PAD_X;

  /** 自上而下：depth 越小越靠上；根在 y = PAD_Y */
  function lay(id: string, depth: number): { left: number; right: number } {
    const v = versionsById[id];
    if (!v) return { left: nextLeafX, right: nextLeafX + NODE };
    const ch = (childrenMap.get(id) ?? []).filter((c) => ids.has(c.id));
    const y = PAD_Y + depth * V_LEVEL;

    if (ch.length === 0) {
      const x = nextLeafX;
      nextLeafX += NODE + H_LEAF_GAP;
      positions[id] = { x, y };
      return { left: x, right: x + NODE };
    }

    let minL = Infinity;
    let maxR = -Infinity;
    for (const c of ch) {
      const r = lay(c.id, depth + 1);
      minL = Math.min(minL, r.left);
      maxR = Math.max(maxR, r.right);
    }
    const cx = (minL + maxR) / 2 - NODE / 2;
    positions[id] = { x: cx, y };
    return { left: cx, right: cx + NODE };
  }

  for (let i = 0; i < roots.length; i++) {
    if (i > 0) nextLeafX += H_LEAF_GAP * 2;
    lay(roots[i]!.id, 0);
  }

  let maxR = 0;
  let maxB = 0;
  for (const p of Object.values(positions)) {
    maxR = Math.max(maxR, p.x + NODE);
    maxB = Math.max(maxB, p.y + NODE);
  }

  return {
    positions,
    width: maxR + PAD_X,
    height: maxB + PAD_Y,
  };
}

function versionIdForDisplayKey(asset: WorkflowAsset, vgp: VgpAssetExtension): string | null {
  const dk = asset.displayKey;
  for (const id of vgp.versionOrder) {
    const v = vgp.versionsById[id];
    if (!v) continue;
    const key = v.imageRef.kind === 'original_field' ? 'original' : v.imageRef.key;
    if (key === dk) return id;
  }
  return null;
}

function clampCanvasZoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(2.5, Math.max(0.35, value));
}

export type WorkflowStepNodeGraphOverlayProps = {
  asset: WorkflowAsset;
  getStepLabel: (stepKey: string) => string;
  onSelectDisplayKey: (key: string) => void;
  onPreviewTexture?: (src: string) => void;
  activePreviewTextureSrc?: string;
  onNodeMenuAction?: (action: WorkflowStepNodeGraphMenuAction, node: WorkflowStepNodeGraphNodeContext) => void;
  /** 当前资产在执行队列或 pending 中：在选中步骤下方追加占位节点并显示生成动画（不盖在原缩略图上） */
  pixelBusy?: boolean;
  pixelBusyInputDisplayKeys?: string[];
};

/**
 * 大图预览：左侧可拖动步骤节点图（VGP 自上而下树 + 父子垂直连线），根/原图在顶部，无外壳边框。
 */
export function WorkflowStepNodeGraphOverlay({
  asset,
  getStepLabel,
  onSelectDisplayKey,
  onPreviewTexture,
  activePreviewTextureSrc = '',
  onNodeMenuAction,
  pixelBusy = false,
  pixelBusyInputDisplayKeys = [],
}: WorkflowStepNodeGraphOverlayProps) {
  const displayAsset = useMemo(() => ensureWorkflowAssetVgp(asset), [asset]);
  const vgp = displayAsset.vgp;
  const selectedId = vgp ? versionIdForDisplayKey(asset, vgp) : null;

  const { positions, width: graphW, height: graphH, edges, ordered, textureInputs, textureRewriteInputs, textureInputEdges, textureRewriteEdges } = useMemo(() => {
    if (!vgp) {
      return {
        positions: {} as Record<string, Pos>,
        width: 0,
        height: 0,
        edges: [] as [string, string][],
        ordered: [] as ImageVersion[],
        textureInputs: [] as Array<PbrTextureInputNode & { x: number; y: number; targetId: string }>,
        textureRewriteInputs: [] as Array<PbrTextureRewriteNode & { sourceX: number; sourceY: number; resultX: number; resultY: number; targetId: string }>,
        textureInputEdges: [] as Array<{ from: string; targetId: string; d: string }>,
        textureRewriteEdges: [] as Array<{ id: string; d: string }>,
      };
    }
    const orderedVersions = vgp.versionOrder.map((id) => vgp.versionsById[id]).filter(Boolean) as ImageVersion[];
    const { positions: basePos, width: baseWidth, height: baseHeight } = layoutVersionGraph(vgp);
    const ids = new Set(vgp.versionOrder);
    const rewriteNodes = collectPbrTextureRewriteNodes(displayAsset.modelPbrTextureLineage);
    const rewrittenResultSrcs = new Set(rewriteNodes.map((node) => node.resultSrc));
    const pbrNodes = collectPbrTextureInputNodes(displayAsset.modelPbrEdits)
      .filter((node) => !rewrittenResultSrcs.has(node.src));
    const modelVersionIds = orderedVersions
      .filter((v) => {
        const key = v.imageRef.kind === 'original_field' ? 'original' : v.imageRef.key;
        return (
          resolveWorkflowStepModelUrls(displayAsset, key).some((url) => String(url || '').trim()) ||
          resolveWorkflowStepModelCompanionKeys(displayAsset, key).some((modelKey) => String(modelKey || '').trim())
        );
      })
      .map((v) => v.id);
    const textureTargetId =
      selectedId && modelVersionIds.includes(selectedId)
        ? selectedId
        : modelVersionIds[0] || null;
    const needsTextureLane = Boolean(textureTargetId && (pbrNodes.length > 0 || rewriteNodes.length > 0));
    const textureLaneW = needsTextureLane
      ? (rewriteNodes.length > 0 ? TEXTURE_NODE * 2 + TEXTURE_NODE_GAP_X * 2 : TEXTURE_NODE + TEXTURE_NODE_GAP_X) + PAD_X
      : 0;
    const pos: Record<string, Pos> = {};
    for (const [id, p] of Object.entries(basePos)) {
      pos[id] = { x: p.x + textureLaneW, y: p.y };
    }
    const e: [string, string][] = [];
    for (const v of orderedVersions) {
      const p = v.parentVersionId;
      if (p && ids.has(p) && pos[p] && pos[v.id]) e.push([p, v.id]);
    }
    const placedTextureInputs: Array<PbrTextureInputNode & { x: number; y: number; targetId: string }> = [];
    const placedRewriteInputs: Array<PbrTextureRewriteNode & { sourceX: number; sourceY: number; resultX: number; resultY: number; targetId: string }> = [];
    const textureEdges: Array<{ from: string; targetId: string; d: string }> = [];
    const rewriteEdges: Array<{ id: string; d: string }> = [];
    let height = baseHeight;
    if (textureTargetId && (pbrNodes.length > 0 || rewriteNodes.length > 0)) {
      const target = pos[textureTargetId];
      if (target) {
        const rows = pbrNodes.length + rewriteNodes.length;
        const totalH = rows * TEXTURE_NODE + Math.max(0, rows - 1) * TEXTURE_NODE_GAP_Y;
        const startY = Math.max(PAD_Y, target.y + NODE / 2 - totalH / 2);
        let row = 0;
        for (let i = 0; i < rewriteNodes.length; i += 1) {
          const node = rewriteNodes[i]!;
          const sourceX = Math.max(PAD_X, target.x - TEXTURE_NODE_GAP_X * 2 - TEXTURE_NODE * 2);
          const resultX = Math.max(PAD_X, target.x - TEXTURE_NODE_GAP_X - TEXTURE_NODE);
          const y = startY + row * (TEXTURE_NODE + TEXTURE_NODE_GAP_Y);
          row += 1;
          placedRewriteInputs.push({ ...node, sourceX, sourceY: y, resultX, resultY: y, targetId: textureTargetId });
          height = Math.max(height, y + TEXTURE_NODE + PAD_Y);
          const sourceOutX = sourceX + TEXTURE_NODE;
          const midInX = resultX;
          const targetInX = target.x;
          const yMid = y + TEXTURE_NODE / 2;
          const targetY = target.y + NODE / 2;
          const midX1 = (sourceOutX + midInX) / 2;
          const midX2 = (resultX + TEXTURE_NODE + targetInX) / 2;
          rewriteEdges.push({
            id: `${node.id}:source`,
            d: `M ${sourceOutX} ${yMid} C ${midX1} ${yMid} ${midX1} ${yMid} ${midInX} ${yMid}`,
          });
          rewriteEdges.push({
            id: `${node.id}:target`,
            d: `M ${resultX + TEXTURE_NODE} ${yMid} C ${midX2} ${yMid} ${midX2} ${targetY} ${targetInX} ${targetY}`,
          });
        }
        for (let i = 0; i < pbrNodes.length; i += 1) {
          const node = pbrNodes[i]!;
          const x = Math.max(PAD_X, target.x - TEXTURE_NODE_GAP_X - TEXTURE_NODE);
          const y = startY + row * (TEXTURE_NODE + TEXTURE_NODE_GAP_Y);
          row += 1;
          placedTextureInputs.push({ ...node, x, y, targetId: textureTargetId });
          height = Math.max(height, y + TEXTURE_NODE + PAD_Y);
          const x1 = x + TEXTURE_NODE;
          const y1 = y + TEXTURE_NODE / 2;
          const x2 = target.x;
          const y2 = target.y + NODE / 2;
          const midX = (x1 + x2) / 2;
          textureEdges.push({
            from: node.id,
            targetId: textureTargetId,
            d: `M ${x1} ${y1} C ${midX} ${y1} ${midX} ${y2} ${x2} ${y2}`,
          });
        }
      }
    }
    return {
      positions: pos,
      width: baseWidth + textureLaneW,
      height,
      edges: e,
      ordered: orderedVersions,
      textureInputs: placedTextureInputs,
      textureRewriteInputs: placedRewriteInputs,
      textureInputEdges: textureEdges,
      textureRewriteEdges: rewriteEdges,
    };
  }, [displayAsset, selectedId, vgp]);

  const busyParentVersionId = useMemo(() => {
    if (!pixelBusy || !vgp) return null;
    const keys = pixelBusyInputDisplayKeys.map((key) => String(key || '').trim()).filter(Boolean);
    for (const key of keys) {
      const parentId = resolveParentVersionIdForInput(vgp, key);
      if (parentId && positions[parentId]) return parentId;
    }
    return selectedId && positions[selectedId] ? selectedId : null;
  }, [pixelBusy, pixelBusyInputDisplayKeys, positions, selectedId, vgp]);

  const generatingPlaceholder = useMemo(() => {
    const baseW = graphW > 0 ? graphW : 80;
    const baseH = graphH > 0 ? graphH : NODE + PAD_Y;
    if (!pixelBusy || !vgp || ordered.length === 0 || !busyParentVersionId) {
      return {
        contentW: baseW,
        contentH: baseH,
        box: null as { x: number; y: number } | null,
        edgeD: null as string | null,
      };
    }
    const p = positions[busyParentVersionId];
    if (!p) {
      return { contentW: baseW, contentH: baseH, box: null, edgeD: null };
    }
    let x = p.x;
    const y = p.y + V_LEVEL;
    const nodeRects: Pos[] = Object.values(positions);
    const overlaps = (ax: number, ay: number) => {
      for (const r of nodeRects) {
        if (!(ax + NODE <= r.x || r.x + NODE <= ax || ay + NODE <= r.y || r.y + NODE <= ay)) {
          return true;
        }
      }
      return false;
    };
    let tries = 0;
    while (overlaps(x, y) && tries < 64) {
      x += NODE + H_LEAF_GAP;
      tries += 1;
    }
    const contentH = Math.max(baseH, y + NODE + PAD_Y);
    const contentW = Math.max(baseW, x + NODE + PAD_X);
    const x1 = p.x + NODE / 2;
    const y1 = p.y + NODE;
    const x2 = x + NODE / 2;
    const y2 = y;
    const midY = (y1 + y2) / 2;
    const edgeD = `M ${x1} ${y1} C ${x1} ${midY} ${x2} ${midY} ${x2} ${y2}`;
    return { contentW, contentH, box: { x, y }, edgeD };
  }, [pixelBusy, vgp, ordered.length, busyParentVersionId, positions, graphW, graphH]);

  const canvasViewportRef = useRef<HTMLDivElement | null>(null);
  const [canvasMode, setCanvasMode] = useState(false);
  const [canvasView, setCanvasView] = useState<CanvasView>({ x: 0, y: 0, zoom: 1 });
  const [canvasPanning, setCanvasPanning] = useState(false);
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(() => new Set());
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [nodeMenu, setNodeMenu] = useState<NodeContextMenu | null>(null);
  const canvasPanRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const selectionBoxRef = useRef<SelectionBox | null>(null);
  const canvasViewInitializedRef = useRef(false);

  const panelH = generatingPlaceholder.contentH > 0 ? generatingPlaceholder.contentH : NODE + PAD_Y;

  useLayoutEffect(() => {
    if (!vgp || ordered.length === 0) return;
    if (canvasViewInitializedRef.current) return;
    canvasViewInitializedRef.current = true;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    setCanvasView((view) => ({
      ...view,
      x: VIEW_MARGIN,
      y: Math.max(VIEW_MARGIN, (vh - panelH) / 2),
    }));
  }, [ordered.length, panelH, vgp]);

  useEffect(() => {
    const onToggleCanvasMode = () => {
      setCanvasMode((active) => !active);
    };
    window.addEventListener(WORKFLOW_PREVIEW_CANVAS_MODE_TOGGLE_EVENT, onToggleCanvasMode);
    return () => window.removeEventListener(WORKFLOW_PREVIEW_CANVAS_MODE_TOGGLE_EVENT, onToggleCanvasMode);
  }, []);

  useEffect(() => {
    setSelectedNodeIds((prev) => {
      const nextId = selectedId ? `version:${selectedId}` : '';
      if (!nextId) return new Set();
      if (prev.size === 1 && prev.has(nextId)) return prev;
      return new Set([nextId]);
    });
  }, [asset.id, selectedId]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (canvasMode) {
      document.documentElement.setAttribute('data-ac-preview-canvas-mode', 'true');
    } else {
      document.documentElement.removeAttribute('data-ac-preview-canvas-mode');
    }
    return () => {
      document.documentElement.removeAttribute('data-ac-preview-canvas-mode');
    };
  }, [canvasMode]);

  useEffect(() => {
    if (!canvasPanning) return;
    const onMove = (e: PointerEvent) => {
      const start = canvasPanRef.current;
      if (!start) return;
      setCanvasView((view) => ({
        ...view,
        x: start.originX + e.clientX - start.startX,
        y: start.originY + e.clientY - start.startY,
      }));
    };
    const onUp = () => {
      canvasPanRef.current = null;
      setCanvasPanning(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [canvasPanning]);

  useEffect(() => {
    if (!selectionBox) return;
    const onMove = (e: PointerEvent) => {
      const start = selectionBoxRef.current;
      if (!start) return;
      const rect = canvasViewportRef.current?.getBoundingClientRect();
      setSelectionBox({
        startX: start.startX,
        startY: start.startY,
        currentX: e.clientX - (rect?.left ?? 0),
        currentY: e.clientY - (rect?.top ?? 0),
      });
    };
    const onUp = (e: PointerEvent) => {
      const start = selectionBoxRef.current;
      selectionBoxRef.current = null;
      setSelectionBox(null);
      if (!start) return;
      const rect = canvasViewportRef.current?.getBoundingClientRect();
      const endX = e.clientX - (rect?.left ?? 0);
      const endY = e.clientY - (rect?.top ?? 0);
      const minX = Math.min(start.startX, endX);
      const maxX = Math.max(start.startX, endX);
      const minY = Math.min(start.startY, endY);
      const maxY = Math.max(start.startY, endY);
      if (maxX - minX < 3 && maxY - minY < 3) {
        setSelectedNodeIds(new Set());
        return;
      }
      const worldMinX = (minX - canvasView.x) / canvasView.zoom;
      const worldMaxX = (maxX - canvasView.x) / canvasView.zoom;
      const worldMinY = (minY - canvasView.y) / canvasView.zoom;
      const worldMaxY = (maxY - canvasView.y) / canvasView.zoom;
      const hits = new Set<string>();
      const intersects = (x: number, y: number, w: number, h: number) =>
        x <= worldMaxX && x + w >= worldMinX && y <= worldMaxY && y + h >= worldMinY;
      for (const [id, p] of Object.entries(positions)) {
        if (intersects(p.x, p.y, NODE, NODE)) hits.add(`version:${id}`);
      }
      for (const input of textureInputs) {
        if (intersects(input.x, input.y, TEXTURE_NODE, TEXTURE_NODE)) hits.add(`texture:${input.id}`);
      }
      for (const input of textureRewriteInputs) {
        if (intersects(input.sourceX, input.sourceY, TEXTURE_NODE, TEXTURE_NODE)) hits.add(`texture:${input.id}:source`);
        if (intersects(input.resultX, input.resultY, TEXTURE_NODE, TEXTURE_NODE)) hits.add(`texture:${input.id}:result`);
      }
      setSelectedNodeIds(hits);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [selectionBox, canvasView, positions, textureInputs, textureRewriteInputs]);

  useEffect(() => {
    if (!canvasMode) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      const rect = canvasViewportRef.current?.getBoundingClientRect();
      const viewportRect = rect && rect.width > 0 && rect.height > 0
        ? rect
        : ({
            left: 0,
            top: 0,
            width: typeof window !== 'undefined' ? window.innerWidth : 1,
            height: typeof window !== 'undefined' ? window.innerHeight : 1,
          } as DOMRect);
      if (!viewportRect.width || !viewportRect.height) return;
      const localX = e.clientX - viewportRect.left;
      const localY = e.clientY - viewportRect.top;
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 120 : e.deltaY;
      const factor = Math.exp(-delta * 0.0018);
      setCanvasView((view) => {
        const nextZoom = clampCanvasZoom(view.zoom * factor);
        if (nextZoom === view.zoom) return view;
        const worldX = (localX - view.x) / view.zoom;
        const worldY = (localY - view.y) / view.zoom;
        return {
          zoom: nextZoom,
          x: localX - worldX * nextZoom,
          y: localY - worldY * nextZoom,
        };
      });
    };
    window.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => window.removeEventListener('wheel', onWheel, { capture: true });
  }, [canvasMode]);

  useEffect(() => {
    if (!nodeMenu) return;
    const close = () => setNodeMenu(null);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close);
      window.removeEventListener('blur', close);
    };
  }, [nodeMenu]);

  if (!vgp || ordered.length === 0) return null;

  const node = (id: string) => {
    const p = positions[id];
    if (!p) return null;
    const v = vgp.versionsById[id];
    if (!v) return null;
    const key = v.imageRef.kind === 'original_field' ? 'original' : v.imageRef.key;
    const nodeId = `version:${id}`;
    const active = selectedId === id || selectedNodeIds.has(nodeId);
    const verSrc = resolveVersionImageSrc(displayAsset, v);
    const textThumb = !String(verSrc || '').trim()
      ? workflowVersionTextThumbLines(displayAsset, key)
      : null;
    const companionKey =
      key === 'original'
        ? String(displayAsset.originalCompanionKey || '').trim()
        : String(displayAsset.resultsCompanionKeys?.[key] || '').trim();
    const nodeAsset = key === displayAsset.displayKey ? displayAsset : { ...displayAsset, displayKey: key };
    const isModelNode =
      resolveWorkflowStepModelUrls(displayAsset, key).some((url) => String(url || '').trim()) ||
      resolveWorkflowStepModelCompanionKeys(displayAsset, key).some((modelKey) => String(modelKey || '').trim());
    const thumbCacheKey = companionKey
      ? `${displayAsset.id}:vgp-step-graph:${v.id}:ck:${companionKey}`
      : `${displayAsset.id}:vgp-step-graph:${v.id}:fp${previewSrcCacheFingerprint(verSrc)}`;
    return (
      <button
        key={id}
        type="button"
        data-pin-nopin="true"
        data-ac-allow-context-menu
        data-workflow-node-id={nodeId}
        title={`第 ${v.stepIndex} 步 · ${getStepLabel(v.stepKey)}`}
        aria-label={`切换到第 ${v.stepIndex} 步：${getStepLabel(v.stepKey)}`}
        aria-current={active ? 'true' : undefined}
        onClick={(e) => {
          e.stopPropagation();
          setNodeMenu(null);
          setSelectedNodeIds(new Set([nodeId]));
          if (!canvasMode && !String(activePreviewTextureSrc || '').trim() && selectedId === id) return;
          onSelectDisplayKey(key);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const nodeContext: WorkflowStepNodeGraphNodeContext = { kind: 'version', nodeId, versionId: id, displayKey: key };
          setSelectedNodeIds(new Set([nodeId]));
          setNodeMenu({ x: e.clientX, y: e.clientY, node: nodeContext });
        }}
        className={[
          'pointer-events-auto absolute overflow-hidden rounded-md transition-shadow outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50',
          active
            ? canvasMode
              ? 'shadow-[0_0_0_2px_rgba(255,255,255,0.95),0_0_16px_rgba(59,130,246,0.38)]'
              : 'shadow-[0_0_0_2px_rgba(59,130,246,0.85)]'
            : 'shadow-none hover:shadow-[0_0_0_1px_rgba(255,255,255,0.2)]',
        ].join(' ')}
        style={{ left: p.x, top: p.y, width: NODE, height: NODE }}
      >
        {textThumb ? (
          <WorkflowVersionTextThumbCell lines={textThumb} />
        ) : isModelNode ? (
          <AssetCardPreviewRenderer
            asset={nodeAsset}
            previewSrc={verSrc}
            cacheKey={thumbCacheKey}
            thumbMaxEdge={128}
            deferThumbnail={false}
            thumbDecodePriority="high"
            imageFetchPriority="high"
            compactBadges
          />
        ) : (
          <WorkflowGridImage
            fullSrc={verSrc}
            cacheKey={thumbCacheKey}
            thumbMaxEdge={128}
            className="relative h-full w-full"
            imgClassName="h-full w-full object-cover"
            alt=""
            draggable={false}
            imageFetchPriority="high"
            thumbDecodePriority="high"
          />
        )}
        <span className="pointer-events-none absolute bottom-0.5 right-0.5 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-[3px] bg-black/50 px-0.5 text-[6px] font-black tabular-nums leading-none text-white/85 shadow-sm ring-1 ring-white/10">
          {v.stepIndex}
        </span>
      </button>
    );
  };

  const edgePaths = edges.map(([from, to], i) => {
    const a = positions[from];
    const b = positions[to];
    if (!a || !b) return null;
    const x1 = a.x + NODE / 2;
    const y1 = a.y + NODE;
    const x2 = b.x + NODE / 2;
    const y2 = b.y;
    const midY = (y1 + y2) / 2;
    const d = `M ${x1} ${y1} C ${x1} ${midY} ${x2} ${midY} ${x2} ${y2}`;
    return <path key={`${from}-${to}-${i}`} d={d} fill="none" stroke="rgba(255,255,255,0.32)" strokeWidth={1.25} vectorEffect="non-scaling-stroke" />;
  });
  const textureEdgePaths = textureInputEdges.map((edge) => (
    <path
      key={`${edge.from}-${edge.targetId}`}
      d={edge.d}
      fill="none"
      stroke="rgba(255,255,255,0.26)"
      strokeWidth={1.15}
      vectorEffect="non-scaling-stroke"
    />
  ));
  const textureRewriteEdgePaths = textureRewriteEdges.map((edge) => (
    <path
      key={edge.id}
      d={edge.d}
      fill="none"
      stroke="rgba(255,255,255,0.30)"
      strokeWidth={1.15}
      vectorEffect="non-scaling-stroke"
    />
  ));

  const textureInputNodes = textureInputs.map((input) => {
    const nodeId = `texture:${input.id}`;
    const selected = selectedNodeIds.has(nodeId);
    return (
    <button
      key={input.id}
      type="button"
      data-ac-allow-context-menu
      data-workflow-node-id={nodeId}
      className={[
        'pointer-events-auto absolute overflow-hidden rounded-md bg-black/45 outline-none transition-shadow',
        selected
          ? 'shadow-[0_0_0_2px_rgba(255,255,255,0.95),0_0_14px_rgba(59,130,246,0.34)]'
          : 'shadow-[0_0_0_1px_rgba(255,255,255,0.14)] hover:shadow-[0_0_0_1px_rgba(255,255,255,0.32)]',
      ].join(' ')}
      style={{ left: input.x, top: input.y, width: TEXTURE_NODE, height: TEXTURE_NODE }}
      title={input.title}
      aria-label={input.title}
      onClick={(e) => {
        e.stopPropagation();
        setNodeMenu(null);
        setSelectedNodeIds(new Set([nodeId]));
        if (!canvasMode && input.src !== activePreviewTextureSrc) onPreviewTexture?.(input.src);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const nodeContext: WorkflowStepNodeGraphNodeContext = {
          kind: 'texture',
          nodeId,
          textureId: input.id,
          src: input.src,
          slots: input.slots,
          materialIds: input.materialIds,
          label: input.label,
        };
        setSelectedNodeIds(new Set([nodeId]));
        setNodeMenu({ x: e.clientX, y: e.clientY, node: nodeContext });
      }}
    >
      <img
        src={input.src}
        alt=""
        draggable={false}
        className="h-full w-full object-cover"
      />
      <span className="absolute inset-x-0 bottom-0 flex h-3.5 items-center justify-center bg-black/55 px-0.5 text-[6px] font-black leading-none text-white/90">
        {input.label}
      </span>
    </button>
    );
  });

  const textureRewriteNodes = textureRewriteInputs.flatMap((input) => {
    const renderTextureButton = (
      key: string,
      nodeId: string,
      src: string,
      x: number,
      y: number,
      label: string,
      title: string
    ) => {
      const selected = selectedNodeIds.has(nodeId);
      return (
        <button
          key={key}
          type="button"
          data-ac-allow-context-menu
          data-workflow-node-id={nodeId}
          className={[
            'pointer-events-auto absolute overflow-hidden rounded-md bg-black/45 outline-none transition-shadow',
            selected
              ? 'shadow-[0_0_0_2px_rgba(255,255,255,0.95),0_0_14px_rgba(59,130,246,0.34)]'
              : 'shadow-[0_0_0_1px_rgba(255,255,255,0.14)] hover:shadow-[0_0_0_1px_rgba(255,255,255,0.32)]',
          ].join(' ')}
          style={{ left: x, top: y, width: TEXTURE_NODE, height: TEXTURE_NODE }}
          title={title}
          aria-label={title}
          onClick={(e) => {
            e.stopPropagation();
            setNodeMenu(null);
            setSelectedNodeIds(new Set([nodeId]));
            if (!canvasMode && src !== activePreviewTextureSrc) onPreviewTexture?.(src);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setSelectedNodeIds(new Set([nodeId]));
            setNodeMenu({
              x: e.clientX,
              y: e.clientY,
              node: {
                kind: 'texture',
                nodeId,
                textureId: input.id,
                src,
                slots: input.slots,
                materialIds: input.materialIds,
                label,
              },
            });
          }}
        >
          <img src={src} alt="" draggable={false} className="h-full w-full object-cover" />
          <span className="absolute inset-x-0 bottom-0 flex h-3.5 items-center justify-center bg-black/55 px-0.5 text-[6px] font-black leading-none text-white/90">
            {label}
          </span>
        </button>
      );
    };
    return [
      renderTextureButton(`${input.id}:source`, `texture:${input.id}:source`, input.sourceSrc, input.sourceX, input.sourceY, input.label, input.title),
      renderTextureButton(`${input.id}:result`, `texture:${input.id}:result`, input.resultSrc, input.resultX, input.resultY, 'New', input.title),
    ];
  });

  const gw = generatingPlaceholder.contentW;
  const gh = generatingPlaceholder.contentH;
  const phBox = generatingPlaceholder.box;
  const phEdge = generatingPlaceholder.edgeD;
  const handleCanvasWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!canvasMode) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = canvasViewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const nextZoom = clampCanvasZoom(canvasView.zoom * (e.deltaY > 0 ? 0.9 : 1.1));
    if (nextZoom === canvasView.zoom) return;
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;
    const worldX = (localX - canvasView.x) / canvasView.zoom;
    const worldY = (localY - canvasView.y) / canvasView.zoom;
    setCanvasView({
      zoom: nextZoom,
      x: localX - worldX * nextZoom,
      y: localY - worldY * nextZoom,
    });
  };
  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!canvasMode) return;
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest('[data-workflow-node-id]')) return;
    if (e.button === 0) {
      e.preventDefault();
      e.stopPropagation();
      const rect = canvasViewportRef.current?.getBoundingClientRect();
      const box = {
        startX: e.clientX - (rect?.left ?? 0),
        startY: e.clientY - (rect?.top ?? 0),
        currentX: e.clientX - (rect?.left ?? 0),
        currentY: e.clientY - (rect?.top ?? 0),
      };
      selectionBoxRef.current = box;
      setSelectionBox(box);
      return;
    }
    if (e.button !== 1) return;
    e.preventDefault();
    e.stopPropagation();
    canvasPanRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: canvasView.x,
      originY: canvasView.y,
    };
    setCanvasPanning(true);
  };
  const wrapperStyle = { position: 'fixed' as const, inset: 0, zIndex: Z_OVERLAY, width: '100vw', height: '100vh' };
  const menuItems: Array<{ action: WorkflowStepNodeGraphMenuAction; label: string }> = [
    { action: 'add-to-input', label: '加入输入框' },
    { action: 'copy-original', label: '复制原始资产' },
    { action: 'copy-id', label: '复制 ID' },
    { action: 'open-folder', label: '打开文件夹' },
    { action: 'show-current', label: '显示当前资产' },
  ];

  const inner = (
    <div
      data-testid="workflow-step-node-graph-overlay"
      className={[
        'select-none transition-shadow',
        canvasMode ? 'pointer-events-auto' : 'pointer-events-none',
        canvasMode
          ? 'rounded-none shadow-[inset_0_0_0_1px_rgba(255,255,255,0.2)]'
          : 'rounded-none shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]',
      ].join(' ')}
      style={wrapperStyle}
      data-image-preview-no-wheel
      onClick={(e) => e.stopPropagation()}
    >
      <div
        ref={canvasViewportRef}
        data-testid="workflow-step-node-graph-viewport"
        className={[
          'absolute inset-0 h-full w-full overflow-hidden rounded-none [scrollbar-width:none]',
          canvasMode ? 'pointer-events-auto' : 'pointer-events-none',
          canvasMode ? (canvasPanning ? 'cursor-grabbing' : 'cursor-crosshair') : '',
        ].join(' ')}
        onPointerDown={handleCanvasPointerDown}
        onWheel={handleCanvasWheel}
      >
        <div
          className="relative"
          style={{ width: '100%', height: '100%' }}
        >
          <div
            data-testid="workflow-step-node-graph-transform"
            className="absolute left-0 top-0"
            style={{
              width: gw,
              height: gh,
              transform: `translate(${canvasView.x}px, ${canvasView.y}px) scale(${canvasView.zoom})`,
              transformOrigin: '0 0',
            }}
          >
          <svg
            className="pointer-events-none absolute left-0 top-0 overflow-visible"
            width={gw}
            height={gh}
            aria-hidden
          >
            {edgePaths}
            {textureEdgePaths}
            {textureRewriteEdgePaths}
            {phEdge ? (
              <path
                key="generating-placeholder-edge"
                d={phEdge}
                fill="none"
                stroke="rgba(59,130,246,0.5)"
                strokeWidth={1.35}
                strokeDasharray="5 4"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
          </svg>
          <div className="relative" style={{ width: gw, height: gh }}>
            {textureInputNodes}
            {textureRewriteNodes}
            {vgp.versionOrder.map((id) => node(id)).filter(Boolean)}
            {phBox ? (
              <div
                className="absolute overflow-hidden rounded-md border border-dashed border-blue-400/45 bg-[#0c1420]/90"
                style={{ left: phBox.x, top: phBox.y, width: NODE, height: NODE }}
                role="status"
                aria-label="新步骤生成中"
                title="新步骤生成中…"
              >
                <WorkflowPixelBusyOverlay
                  executing
                  accentExecuting
                  density="compact"
                  progressDetail="生成中…"
                  backdropImageSrc={null}
                  className="pointer-events-none absolute inset-0 rounded-[inherit]"
                />
                <span className="pointer-events-none absolute bottom-0.5 right-0.5 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-[3px] bg-black/50 px-0.5 text-[6px] font-black tabular-nums leading-none text-blue-200/90 shadow-sm ring-1 ring-white/10">
                  ···
                </span>
              </div>
            ) : null}
          </div>
          </div>
        </div>
        {selectionBox ? (
          <div
            className="pointer-events-none absolute border border-white/70 bg-blue-400/10 shadow-[0_0_0_1px_rgba(59,130,246,0.22)]"
            style={{
              left: Math.min(selectionBox.startX, selectionBox.currentX),
              top: Math.min(selectionBox.startY, selectionBox.currentY),
              width: Math.abs(selectionBox.currentX - selectionBox.startX),
              height: Math.abs(selectionBox.currentY - selectionBox.startY),
            }}
          />
        ) : null}
        {nodeMenu ? (
          <div
            className="pointer-events-auto fixed z-[1] min-w-28 overflow-hidden rounded-md bg-[#09090b]/95 py-1 text-[11px] font-semibold text-gray-200 shadow-2xl ring-1 ring-white/15 backdrop-blur"
            data-ac-allow-context-menu
            style={{
              left: Math.min(nodeMenu.x, (typeof window !== 'undefined' ? window.innerWidth : 1280) - 124),
              top: Math.min(nodeMenu.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 156),
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            role="menu"
          >
            {menuItems.map((item) => (
              <button
                key={item.action}
                type="button"
                className="block w-full px-3 py-1.5 text-left text-gray-200 hover:bg-white/[0.09] hover:text-white focus-visible:bg-white/[0.09] focus-visible:outline-none"
                role="menuitem"
                onClick={() => {
                  const node = nodeMenu.node;
                  setNodeMenu(null);
                  onNodeMenuAction?.(item.action, node);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(inner, document.body);
}
