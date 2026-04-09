import { Position, getBezierPath } from '@xyflow/react';
import type { Edge, Node } from '@xyflow/react';

const DEFAULT_NODE_W = 108;
const DEFAULT_NODE_H = 158;

function nodeBox(n: Node): { w: number; h: number } {
  const mw = n.measured?.width ?? n.width;
  const mh = n.measured?.height ?? n.height;
  const w = typeof mw === 'number' && mw > 0 ? mw : DEFAULT_NODE_W;
  const h = typeof mh === 'number' && mh > 0 ? mh : DEFAULT_NODE_H;
  return { w, h };
}

/** 与画布资产卡默认连线一致：源右侧 → 目标左侧 */
export function getFlowHandleCoords(
  n: Node,
  side: 'source' | 'target'
): { x: number; y: number; position: Position } {
  const { w, h } = nodeBox(n);
  const { x, y } = n.position;
  if (side === 'source') {
    return { x: x + w, y: y + h / 2, position: Position.Right };
  }
  return { x, y: y + h / 2, position: Position.Left };
}

function cubicPoint(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

type Cubic = {
  p0: { x: number; y: number };
  p1: { x: number; y: number };
  p2: { x: number; y: number };
  p3: { x: number; y: number };
};

function parseBezierFromPath(d: string): Cubic | null {
  const m = d.match(
    /^M\s*([\d.-]+),([\d.-]+)\s*C\s*([\d.-]+),([\d.-]+)\s+([\d.-]+),([\d.-]+)\s+([\d.-]+),([\d.-]+)/
  );
  if (!m) return null;
  return {
    p0: { x: +m[1], y: +m[2] },
    p1: { x: +m[3], y: +m[4] },
    p2: { x: +m[5], y: +m[6] },
    p3: { x: +m[7], y: +m[8] },
  };
}

function bezierControls(
  sx: number,
  sy: number,
  sp: Position,
  tx: number,
  ty: number,
  tp: Position,
  curvature = 0.25
): Cubic | null {
  const [path] = getBezierPath({
    sourceX: sx,
    sourceY: sy,
    sourcePosition: sp,
    targetX: tx,
    targetY: ty,
    targetPosition: tp,
    curvature,
  });
  return parseBezierFromPath(path);
}

function closestOnBezier(
  px: number,
  py: number,
  c: Cubic,
  samples = 56
): { t: number; x: number; y: number; dist2: number } {
  let bestT = 0.5;
  let bestD2 = Infinity;
  let bestX = 0;
  let bestY = 0;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const x = cubicPoint(t, c.p0.x, c.p1.x, c.p2.x, c.p3.x);
    const y = cubicPoint(t, c.p0.y, c.p1.y, c.p2.y, c.p3.y);
    const d2 = dist2(px, py, x, y);
    if (d2 < bestD2) {
      bestD2 = d2;
      bestT = t;
      bestX = x;
      bestY = y;
    }
  }
  return { t: bestT, x: bestX, y: bestY, dist2: bestD2 };
}

export type ClosestFlowEdgeHit = {
  edge: Edge;
  flowX: number;
  flowY: number;
  t: number;
};

/** 在流程坐标系下找离鼠标最近的边（与默认 Bezier 边几何一致） */
export function findClosestFlowEdgeHit(
  flowX: number,
  flowY: number,
  nodes: Node[],
  edges: Edge[],
  maxDistPx: number
): ClosestFlowEdgeHit | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let best: ClosestFlowEdgeHit | null = null;
  let bestD2 = maxDistPx * maxDistPx;

  for (const edge of edges) {
    const sn = byId.get(edge.source);
    const tn = byId.get(edge.target);
    if (!sn || !tn) continue;
    const sh = getFlowHandleCoords(sn, 'source');
    const th = getFlowHandleCoords(tn, 'target');
    const bez = bezierControls(sh.x, sh.y, sh.position, th.x, th.y, th.position);
    if (!bez) continue;
    const r = closestOnBezier(flowX, flowY, bez);
    if (r.dist2 < bestD2) {
      bestD2 = r.dist2;
      best = { edge, flowX: r.x, flowY: r.y, t: r.t };
    }
  }
  return best;
}
