import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { WorkflowAsset } from '../types';
import type { ImageVersion, VgpAssetExtension } from '../types/vgp';
import { ensureWorkflowAssetVgp } from '../services/vgp/migrateLegacyAsset';
import { previewSrcCacheFingerprint } from '../services/workflowImageThumb';
import { WorkflowGridImage } from './ProgressivePreviewImage';
import WorkflowPixelBusyOverlay from './WorkflowPixelBusyOverlay';
import { resolveVersionImageSrc } from './WorkflowGenerationRecordPanel';

const NODE = 52;
/** 自上而下树：叶子子树之间的水平间距 */
const H_LEAF_GAP = 14;
/** 层与层之间的垂直步进（含节点） */
const V_LEVEL = NODE + 16;
const PAD_X = 12;
const PAD_Y = 8;
const HANDLE_H = 22;
const Z_OVERLAY = 2300;
const VIEW_MARGIN = 8;
/** 图形容器最大高度，避免整卡过高被夹到视口底部 */
const GRAPH_MAX_H_CSS = 'min(72vh, 520px)';

type Pos = { x: number; y: number };

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

function clampPanel(
  left: number,
  top: number,
  panelW: number,
  panelH: number,
  vw: number,
  vh: number
): { left: number; top: number } {
  const maxL = Math.max(VIEW_MARGIN, vw - panelW - VIEW_MARGIN);
  const maxT = Math.max(VIEW_MARGIN, vh - panelH - VIEW_MARGIN);
  return {
    left: Math.max(VIEW_MARGIN, Math.min(maxL, left)),
    top: Math.max(VIEW_MARGIN, Math.min(maxT, top)),
  };
}

export type WorkflowStepNodeGraphOverlayProps = {
  asset: WorkflowAsset;
  getStepLabel: (stepKey: string) => string;
  onSelectDisplayKey: (key: string) => void;
  /** 当前资产在执行队列或 pending 中：在选中步骤下方追加占位节点并显示生成动画（不盖在原缩略图上） */
  pixelBusy?: boolean;
};

/**
 * 大图预览：左侧可拖动步骤节点图（VGP 自上而下树 + 父子垂直连线），根/原图在顶部，无外壳边框。
 */
export function WorkflowStepNodeGraphOverlay({
  asset,
  getStepLabel,
  onSelectDisplayKey,
  pixelBusy = false,
}: WorkflowStepNodeGraphOverlayProps) {
  const displayAsset = useMemo(() => ensureWorkflowAssetVgp(asset), [asset]);
  const vgp = displayAsset.vgp;

  const { positions, width: graphW, height: graphH, edges, ordered } = useMemo(() => {
    if (!vgp) {
      return { positions: {} as Record<string, Pos>, width: 0, height: 0, edges: [] as [string, string][], ordered: [] as ImageVersion[] };
    }
    const orderedVersions = vgp.versionOrder.map((id) => vgp.versionsById[id]).filter(Boolean) as ImageVersion[];
    const { positions: pos, width, height } = layoutVersionGraph(vgp);
    const ids = new Set(vgp.versionOrder);
    const e: [string, string][] = [];
    for (const v of orderedVersions) {
      const p = v.parentVersionId;
      if (p && ids.has(p) && pos[p] && pos[v.id]) e.push([p, v.id]);
    }
    return { positions: pos, width, height, edges: e, ordered: orderedVersions };
  }, [vgp]);

  const selectedId = vgp ? versionIdForDisplayKey(asset, vgp) : null;

  const generatingPlaceholder = useMemo(() => {
    const baseW = graphW > 0 ? graphW : 80;
    const baseH = graphH > 0 ? graphH : NODE + PAD_Y;
    if (!pixelBusy || !vgp || ordered.length === 0 || !selectedId) {
      return {
        contentW: baseW,
        contentH: baseH,
        box: null as { x: number; y: number } | null,
        edgeD: null as string | null,
      };
    }
    const p = positions[selectedId];
    if (!p) {
      return { contentW: baseW, contentH: baseH, box: null, edgeD: null };
    }
    let x = p.x;
    let y = p.y + V_LEVEL;
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
  }, [pixelBusy, vgp, ordered.length, selectedId, positions, graphW, graphH]);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [panelPos, setPanelPos] = useState<{ left: number; top: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null);

  const panelW = generatingPlaceholder.contentW > 0 ? generatingPlaceholder.contentW : 80;
  const panelH = HANDLE_H + 8 + (generatingPlaceholder.contentH > 0 ? generatingPlaceholder.contentH : NODE + PAD_Y);

  const resetPosition = useCallback(() => {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    requestAnimationFrame(() => {
      const el = wrapRef.current;
      const w = el?.offsetWidth ?? panelW;
      const h = el?.offsetHeight ?? panelH;
      const desiredLeft = VIEW_MARGIN;
      const desiredTop = (vh - h) / 2;
      setPanelPos(clampPanel(desiredLeft, desiredTop, w, h, vw, vh));
    });
  }, [panelH, panelW]);

  useLayoutEffect(() => {
    if (panelPos !== null) return;
    if (!vgp || ordered.length === 0) return;
    resetPosition();
  }, [ordered.length, panelPos, resetPosition, vgp]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const off = dragOffsetRef.current;
      if (!off) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const el = wrapRef.current;
      const w = el?.offsetWidth ?? panelW;
      const h = el?.offsetHeight ?? panelH;
      setPanelPos(clampPanel(e.clientX - off.x, e.clientY - off.y, w, h, vw, vh));
    };
    const onUp = () => {
      dragOffsetRef.current = null;
      setDragging(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, panelH, panelW]);

  useEffect(() => {
    const onResize = () => {
      setPanelPos((prev) => {
        if (!prev) return prev;
        const el = wrapRef.current;
        const w = el?.offsetWidth ?? panelW;
        const h = el?.offsetHeight ?? panelH;
        return clampPanel(prev.left, prev.top, w, h, window.innerWidth, window.innerHeight);
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [panelH, panelW]);

  if (!vgp || ordered.length === 0) return null;

  const node = (id: string) => {
    const p = positions[id];
    if (!p) return null;
    const v = vgp.versionsById[id];
    if (!v) return null;
    const key = v.imageRef.kind === 'original_field' ? 'original' : v.imageRef.key;
    const active = selectedId === id;
    const verSrc = resolveVersionImageSrc(displayAsset, v);
    const thumbCacheKey = `${displayAsset.id}:vgp-step-graph:${v.id}:fp${previewSrcCacheFingerprint(verSrc)}`;
    return (
      <button
        key={id}
        type="button"
        data-pin-nopin="true"
        title={`第 ${v.stepIndex} 步 · ${getStepLabel(v.stepKey)}`}
        aria-label={`切换到第 ${v.stepIndex} 步：${getStepLabel(v.stepKey)}`}
        aria-current={active ? 'true' : undefined}
        onClick={(e) => {
          e.stopPropagation();
          onSelectDisplayKey(key);
        }}
        className={[
          'absolute overflow-hidden rounded-md transition-shadow outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50',
          active ? 'shadow-[0_0_0_2px_rgba(59,130,246,0.85)]' : 'shadow-none hover:shadow-[0_0_0_1px_rgba(255,255,255,0.2)]',
        ].join(' ')}
        style={{ left: p.x, top: p.y, width: NODE, height: NODE }}
      >
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
        <span className="pointer-events-none absolute bottom-0 inset-x-0 bg-black/55 text-[7px] font-black tabular-nums text-white/95 text-center py-px">
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

  const gw = generatingPlaceholder.contentW;
  const gh = generatingPlaceholder.contentH;
  const phBox = generatingPlaceholder.box;
  const phEdge = generatingPlaceholder.edgeD;

  const inner = (
    <div
      ref={wrapRef}
      className="pointer-events-auto select-none"
      style={
        panelPos
          ? { position: 'fixed', left: panelPos.left, top: panelPos.top, zIndex: Z_OVERLAY, width: panelW }
          : { position: 'fixed', left: -9999, top: -9999, zIndex: Z_OVERLAY, opacity: 0, pointerEvents: 'none', width: panelW }
      }
      data-image-preview-no-wheel
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onDoubleClick={(e) => {
          e.stopPropagation();
          resetPosition();
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          const rect = wrapRef.current?.getBoundingClientRect();
          if (!rect) return;
          dragOffsetRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
          setDragging(true);
        }}
        className="mb-1 flex h-[22px] w-9 cursor-grab items-center justify-center rounded-md text-[10px] leading-none tracking-tighter text-white/35 hover:bg-white/[0.06] hover:text-white/55 active:cursor-grabbing"
        title="拖动节点图（双击复位到左侧垂直居中）"
        aria-label="拖动步骤节点图"
      >
        ⋮⋮
      </button>
      <div
        className="relative max-w-[min(92vw,22rem)] overflow-x-hidden overflow-y-auto no-scrollbar"
        style={{ width: panelW, maxHeight: GRAPH_MAX_H_CSS }}
      >
        <div className="relative" style={{ width: panelW, height: gh }}>
          <svg
            className="pointer-events-none absolute left-0 top-0 overflow-visible"
            width={gw}
            height={gh}
            aria-hidden
          >
            {edgePaths}
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
                <span className="pointer-events-none absolute bottom-0 inset-x-0 bg-black/55 text-[7px] font-black tabular-nums text-blue-200/95 text-center py-px">
                  ···
                </span>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(inner, document.body);
}
