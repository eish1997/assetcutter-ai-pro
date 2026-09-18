import { readLocalJson, writeLocalJson } from './clientPersist';
import { layoutBoardDefault } from './workshopFrontHallLayout';
import {
  frontHallListingKind,
  frontHallNodeMatchesViewFilter,
  workshopFrontHallFrameId,
  workshopFrontHallPreviewUrlIsUsable,
  type FrontHallViewFilter,
  type WorkshopFrontHallBoardState,
  type WorkshopFrontHallEdge,
  type WorkshopFrontHallLayoutMap,
} from './workshopFrontHall';
import { toPosixRel, workshopFileAssetId } from './workshopFileTree';
import { CanvasNodeType, type CanvasNodeData, type ViewportTransform } from '@ic/types/canvas';

export const WORKSHOP_FRONT_HALL_GRAPH_KEY_PREFIX = 'workshopFrontHallGraph';

export type WorkshopFrontHallExtraNode = CanvasNodeData;

export type WorkshopFrontHallGraphPersist = {
  v: 1;
  viewport: ViewportTransform;
  edges: WorkshopFrontHallEdge[];
  extraNodes: WorkshopFrontHallExtraNode[];
};

const DEFAULT_VIEWPORT: ViewportTransform = { x: 0, y: 0, k: 1 };

const SIZE: Record<string, { width: number; height: number }> = {
  [CanvasNodeType.Image]: { width: 340, height: 240 },
  [CanvasNodeType.Text]: { width: 340, height: 240 },
  [CanvasNodeType.Video]: { width: 420, height: 236 },
  [CanvasNodeType.Audio]: { width: 340, height: 120 },
  [CanvasNodeType.Group]: { width: 760, height: 480 },
  [CanvasNodeType.Config]: { width: 340, height: 240 },
};

export function workshopFrontHallGraphStorageKey(root: string): string {
  return `${WORKSHOP_FRONT_HALL_GRAPH_KEY_PREFIX}:${String(root || '').trim()}`;
}

function finiteNum(n: unknown, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

function parseViewport(raw: unknown): ViewportTransform {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_VIEWPORT };
  const o = raw as Record<string, unknown>;
  return {
    x: finiteNum(o.x, 0),
    y: finiteNum(o.y, 0),
    k: Math.min(5, Math.max(0.05, finiteNum(o.k ?? o.zoom, 1))),
  };
}

function parseEdge(raw: unknown): WorkshopFrontHallEdge | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const fromNodeId = String(o.fromNodeId || '').trim();
  const toNodeId = String(o.toNodeId || '').trim();
  if (!fromNodeId || !toNodeId) return null;
  const id = String(o.id || '').trim() || frontHallEdgeId(fromNodeId, toNodeId);
  return { id, fromNodeId, toNodeId };
}

function parseExtraNode(raw: unknown): WorkshopFrontHallExtraNode | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id || '').trim();
  if (!id) return null;
  const pos = o.position && typeof o.position === 'object' ? (o.position as Record<string, unknown>) : {};
  return {
    id,
    type: (typeof o.type === 'string' && o.type ? o.type : CanvasNodeType.Text) as CanvasNodeData['type'],
    title: String(o.title || id),
    position: { x: finiteNum(pos.x, 0), y: finiteNum(pos.y, 0) },
    width: finiteNum(o.width, 340),
    height: finiteNum(o.height, 240),
    metadata: o.metadata && typeof o.metadata === 'object' ? (o.metadata as CanvasNodeData['metadata']) : undefined,
  };
}

export function parseWorkshopFrontHallGraph(raw: unknown): WorkshopFrontHallGraphPersist {
  if (!raw || typeof raw !== 'object') {
    return { v: 1, viewport: { ...DEFAULT_VIEWPORT }, edges: [], extraNodes: [] };
  }
  const o = raw as Record<string, unknown>;
  const edges = Array.isArray(o.edges) ? o.edges.map(parseEdge).filter((e): e is WorkshopFrontHallEdge => Boolean(e)) : [];
  const extraNodes = Array.isArray(o.extraNodes)
    ? o.extraNodes.map(parseExtraNode).filter((n): n is WorkshopFrontHallExtraNode => Boolean(n))
    : [];
  return { v: 1, viewport: parseViewport(o.viewport), edges, extraNodes };
}

export function readWorkshopFrontHallGraph(root: string): WorkshopFrontHallGraphPersist {
  return readLocalJson(workshopFrontHallGraphStorageKey(root), parseWorkshopFrontHallGraph(null), (parsed) =>
    parseWorkshopFrontHallGraph(parsed),
  );
}

export function writeWorkshopFrontHallGraph(root: string, graph: WorkshopFrontHallGraphPersist): void {
  writeLocalJson(workshopFrontHallGraphStorageKey(root), parseWorkshopFrontHallGraph(graph));
}

export function frontHallEdgeId(fromNodeId: string, toNodeId: string): string {
  return `edge:${fromNodeId}:${toNodeId}`;
}

export function connectFrontHallNodes(
  edges: WorkshopFrontHallEdge[],
  fromNodeId: string,
  toNodeId: string,
): WorkshopFrontHallEdge[] {
  const from = String(fromNodeId || '').trim();
  const to = String(toNodeId || '').trim();
  if (!from || !to || from === to) return edges;
  const id = frontHallEdgeId(from, to);
  if (edges.some((edge) => edge.id === id || (edge.fromNodeId === from && edge.toNodeId === to))) return edges;
  return [...edges, { id, fromNodeId: from, toNodeId: to }];
}

export function disconnectFrontHallEdge(edges: WorkshopFrontHallEdge[], edgeId: string): WorkshopFrontHallEdge[] {
  const id = String(edgeId || '').trim();
  if (!id) return edges;
  return edges.filter((edge) => edge.id !== id);
}

function basenameTitle(relOrId: string): string {
  const posix = toPosixRel(relOrId.includes('::') ? relOrId.slice(relOrId.lastIndexOf('::') + 2) : relOrId);
  const name = posix.split('/').filter(Boolean).pop() || posix || 'node';
  return name.includes('::') ? name.slice(name.lastIndexOf('::') + 2) : name;
}

function kindFromRel(rel: string): CanvasNodeType {
  const kind = frontHallListingKind(rel);
  if (kind === 'image') return CanvasNodeType.Image;
  if (kind === 'video') return CanvasNodeType.Video;
  if (kind === 'text') return CanvasNodeType.Text;
  return CanvasNodeType.Text;
}

function fileRelForNode(state: WorkshopFrontHallBoardState, nodeId: string): string {
  const tok = (state.tokens || []).find((token) => token.nodeId === nodeId);
  if (tok?.fileRel) return toPosixRel(tok.fileRel);
  const marker = '::';
  const i = nodeId.lastIndexOf(marker);
  return i >= 0 ? toPosixRel(nodeId.slice(i + marker.length)) : nodeId;
}

export function boardStateToCanvasNodes(
  state: WorkshopFrontHallBoardState,
  layout?: WorkshopFrontHallLayoutMap | null,
  extraNodes: WorkshopFrontHallExtraNode[] = [],
): CanvasNodeData[] {
  const poses = layoutBoardDefault(state, layout);
  const out: CanvasNodeData[] = [];
  for (const folderRel of state.frames || []) {
    const id = workshopFrontHallFrameId(state.root, folderRel);
    const pose = poses[id] || { x: 0, y: 0 };
    const size = SIZE[CanvasNodeType.Group];
    out.push({
      id,
      type: CanvasNodeType.Group,
      title: folderRel ? basenameTitle(folderRel) : 'root',
      position: { x: pose.x, y: pose.y },
      width: pose.width || size.width,
      height: pose.height || size.height,
      metadata: { folderRel: toPosixRel(folderRel) },
    });
  }
  for (const node of state.nodes || []) {
    const pose = poses[node.id] || { x: 0, y: 0 };
    const fileRel = fileRelForNode(state, node.id);
    const type = kindFromRel(fileRel);
    const size = SIZE[type] || SIZE[CanvasNodeType.Text];
    out.push({
      id: node.id,
      type,
      title: basenameTitle(fileRel),
      position: { x: pose.x, y: pose.y },
      width: pose.width || size.width,
      height: pose.height || size.height,
      metadata: {
        folderRel: toPosixRel(node.folderRel),
        groupId: workshopFrontHallFrameId(state.root, node.folderRel),
        content: fileRel,
        status: 'idle',
      },
    });
  }
  const seen = new Set(out.map((node) => node.id));
  for (const extra of extraNodes) {
    if (!extra?.id || seen.has(extra.id)) continue;
    seen.add(extra.id);
    out.push(extra);
  }
  return out;
}

export function canvasNodesToLayout(nodes: CanvasNodeData[]): WorkshopFrontHallLayoutMap {
  const next: WorkshopFrontHallLayoutMap = {};
  for (const node of nodes || []) {
    if (!node?.id) continue;
    const width = finiteNum(node.width, 0);
    const height = finiteNum(node.height, 0);
    next[node.id] = {
      x: finiteNum(node.position?.x, 0),
      y: finiteNum(node.position?.y, 0),
      width: width > 0 ? width : undefined,
      height: height > 0 ? height : undefined,
    };
  }
  return next;
}

export function frontHallListingNodeIds(state: WorkshopFrontHallBoardState): Set<string> {
  const ids = new Set<string>();
  const root = String(state.root || '').trim();
  for (const folderRel of state.frames || []) ids.add(workshopFrontHallFrameId(root, folderRel));
  for (const node of state.nodes || []) {
    if (node?.id) ids.add(node.id);
  }
  return ids;
}

export function isFrontHallFolderFrame(node: CanvasNodeData): boolean {
  return node.type === CanvasNodeType.Group && Boolean(node.metadata && 'folderRel' in node.metadata);
}

export function extraNodesFromLive(nodes: CanvasNodeData[], listingIds: Set<string>): WorkshopFrontHallExtraNode[] {
  return (nodes || []).filter((node) => node?.id && !listingIds.has(node.id));
}

export function mergeFrontHallLiveNodes(prev: CanvasNodeData[], listing: CanvasNodeData[]): CanvasNodeData[] {
  const listingIds = new Set(listing.map((node) => node.id));
  const prevById = new Map(prev.map((node) => [node.id, node]));
  const next = listing.map((node) => {
    const old = prevById.get(node.id);
    if (!old) return node;
    return {
      ...node,
      position: old.position,
      width: old.width,
      height: old.height,
      title: old.title || node.title,
    };
  });
  for (const node of prev) {
    if (!listingIds.has(node.id)) next.push(node);
  }
  return next;
}

export function addFrontHallCanvasNode(opts: {
  root: string;
  folderRel: string;
  kind: 'image' | 'video' | 'text' | 'file' | 'audio';
  originPose: { x: number; y: number };
  now: number;
}): WorkshopFrontHallExtraNode {
  const type =
    opts.kind === 'video'
      ? CanvasNodeType.Video
      : opts.kind === 'audio'
        ? CanvasNodeType.Audio
        : opts.kind === 'image'
          ? CanvasNodeType.Image
          : CanvasNodeType.Text;
  const size = SIZE[type] || SIZE[CanvasNodeType.Text];
  const folderRel = toPosixRel(opts.folderRel);
  const id = `board:${opts.root}:${folderRel}:${opts.now}`;
  return {
    id,
    type,
    title: opts.kind,
    position: { x: opts.originPose.x, y: opts.originPose.y },
    width: size.width,
    height: size.height,
    metadata: {
      folderRel,
      groupId: workshopFrontHallFrameId(opts.root, folderRel),
      status: 'idle',
    },
  };
}

export function frontHallPreviewMap(
  thumbs: Record<string, string> | null | undefined,
  state: WorkshopFrontHallBoardState,
): Record<string, string> {
  const src = thumbs || {};
  const next: Record<string, string> = {};
  for (const node of state.nodes || []) {
    const fileRel = fileRelForNode(state, node.id);
    const assetId = workshopFileAssetId(state.root, fileRel);
    const candidates = [src[node.id], src[assetId], src[fileRel], src[toPosixRel(fileRel)]];
    const hit = candidates.find((url) => typeof url === 'string' && workshopFrontHallPreviewUrlIsUsable(url));
    if (hit) next[node.id] = hit;
  }
  return next;
}

export function filterCanvasNodesForView(
  nodes: CanvasNodeData[],
  filter?: FrontHallViewFilter | null,
): CanvasNodeData[] {
  const list = nodes || [];
  if (!filter) return list;
  if (filter.kinds == null && !String(filter.nameQuery || '').trim()) return list;
  const files = (nodes || []).filter((node) => {
    if (node.type === CanvasNodeType.Group) return false;
    const content =
      node.metadata && 'content' in node.metadata && typeof node.metadata.content === 'string'
        ? String(node.metadata.content)
        : '';
    const fileRel = content && !/^(data:|blob:)/i.test(content) ? content : node.title;
    const fromRel = frontHallListingKind(fileRel);
    const kind =
      fromRel !== 'file'
        ? fromRel
        : node.type === CanvasNodeType.Image
          ? 'image'
          : node.type === CanvasNodeType.Video
            ? 'video'
            : node.type === CanvasNodeType.Audio
              ? 'file'
              : node.type === CanvasNodeType.Text
                ? 'text'
                : 'file';
    return frontHallNodeMatchesViewFilter({ fileRel, title: node.title, kind }, filter);
  });
  const visibleFolders = new Set<string>();
  for (const node of files) {
    const folderRel =
      node.metadata && 'folderRel' in node.metadata
        ? String((node.metadata as { folderRel?: string }).folderRel || '')
        : '';
    let cur = toPosixRel(folderRel);
    visibleFolders.add(cur);
    while (cur) {
      const i = cur.lastIndexOf('/');
      cur = i < 0 ? '' : cur.slice(0, i);
      visibleFolders.add(cur);
    }
  }
  const groups = (nodes || []).filter((node) => {
    if (node.type !== CanvasNodeType.Group) return false;
    const folderRel =
      node.metadata && 'folderRel' in node.metadata
        ? String((node.metadata as { folderRel?: string }).folderRel || '')
        : '';
    return visibleFolders.has(toPosixRel(folderRel));
  });
  return [...groups, ...files];
}

