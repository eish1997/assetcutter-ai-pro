import { readLocalJson, writeLocalJson } from './clientPersist';
import {
  workshopFrontHallFrameId,
  type WorkshopFrontHallBoardState,
  type WorkshopFrontHallLayoutMap,
  type WorkshopFrontHallLayoutPose,
} from './workshopFrontHall';
import { toPosixRel } from './workshopFileTree';

export const WORKSHOP_FRONT_HALL_LAYOUT_KEY_PREFIX = 'workshopFrontHallLayout';
const FILE_W = 420;
const FILE_H = 240;
const NODE_GAP = 48;
const NODE_COLS = 4;
const FRAME_MARGIN = 96;
const EMPTY_FRAME_W = 520;
const EMPTY_FRAME_H = 360;
const COLLAPSE_CLUSTER = 3;
const PUSH_GAP = 32;
const WRAP_PAD = 24;
const WRAP_TOP = 52;
const PUSH_ITERS = 80;

export function workshopFrontHallLayoutStorageKey(root: string): string {
  return `${WORKSHOP_FRONT_HALL_LAYOUT_KEY_PREFIX}:${String(root || '').trim()}`;
}

function isPose(value: unknown): value is WorkshopFrontHallLayoutPose {
  if (!value || typeof value !== 'object') return false;
  const o = value as Record<string, unknown>;
  return typeof o.x === 'number' && Number.isFinite(o.x) && typeof o.y === 'number' && Number.isFinite(o.y);
}

function optionalSize(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function parseWorkshopFrontHallLayout(raw: unknown): WorkshopFrontHallLayoutMap {
  if (!raw || typeof raw !== 'object') return {};
  const posesRaw =
    'poses' in raw && raw.poses && typeof raw.poses === 'object'
      ? (raw as { poses: Record<string, unknown> }).poses
      : (raw as Record<string, unknown>);
  const next: WorkshopFrontHallLayoutMap = {};
  for (const [id, value] of Object.entries(posesRaw)) {
    if (!id || !isPose(value)) continue;
    const o = value as WorkshopFrontHallLayoutPose;
    next[id] = {
      x: o.x,
      y: o.y,
      z: typeof o.z === 'number' && Number.isFinite(o.z) ? o.z : undefined,
      width: optionalSize(o.width),
      height: optionalSize(o.height),
    };
  }
  return next;
}

export function readWorkshopFrontHallLayout(root: string): WorkshopFrontHallLayoutMap {
  return readLocalJson(workshopFrontHallLayoutStorageKey(root), {}, (parsed) => parseWorkshopFrontHallLayout(parsed));
}

export function writeWorkshopFrontHallLayout(root: string, map: WorkshopFrontHallLayoutMap): void {
  writeLocalJson(workshopFrontHallLayoutStorageKey(root), { v: 1, poses: parseWorkshopFrontHallLayout(map) });
}

function layoutIds(state: WorkshopFrontHallBoardState): string[] {
  const root = String(state.root || '').trim();
  const ids = (state.frames || []).map((rel) => workshopFrontHallFrameId(root, rel));
  for (const node of state.nodes || []) {
    if (node?.id) ids.push(node.id);
  }
  return ids;
}

/** Drop poses that share a cell with enough other nodes to be a collapsed default, not a user stack. */
export function dropCollapsedFrontHallPoses(
  map: WorkshopFrontHallLayoutMap,
  ids: Iterable<string>,
  cluster = COLLAPSE_CLUSTER,
): WorkshopFrontHallLayoutMap {
  const next = parseWorkshopFrontHallLayout(map);
  const buckets = new Map<string, string[]>();
  for (const id of ids) {
    const pose = next[id];
    if (!pose) continue;
    const key = `${Math.round(pose.x)}:${Math.round(pose.y)}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(id);
    else buckets.set(key, [id]);
  }
  for (const bucket of buckets.values()) {
    if (bucket.length < cluster) continue;
    for (const id of bucket) delete next[id];
  }
  return next;
}

function gridMetrics(count: number): { cols: number; rows: number; width: number; height: number } {
  const n = Math.max(0, count);
  if (n <= 0) return { cols: 1, rows: 1, width: EMPTY_FRAME_W, height: EMPTY_FRAME_H };
  const cols = Math.min(NODE_COLS, n);
  const rows = Math.max(1, Math.ceil(n / cols));
  return {
    cols,
    rows,
    width: WRAP_PAD * 2 + cols * FILE_W + Math.max(0, cols - 1) * NODE_GAP,
    height: WRAP_TOP + WRAP_PAD + rows * FILE_H + Math.max(0, rows - 1) * NODE_GAP,
  };
}

/** Disk poses always win over freshly packed defaults, unless they are a collapsed pile. */
export function ensureWorkshopFrontHallLayout(
  state: WorkshopFrontHallBoardState,
  extra?: WorkshopFrontHallLayoutMap | null,
): WorkshopFrontHallLayoutMap {
  const disk = readWorkshopFrontHallLayout(state.root);
  const saved = parseWorkshopFrontHallLayout({
    ...parseWorkshopFrontHallLayout(extra || {}),
    ...disk,
  });
  const ids = layoutIds(state);
  const cleaned = dropCollapsedFrontHallPoses(saved, ids);
  const next = layoutBoardDefault(state, cleaned);
  const changed = ids.some((id) => {
    const before = disk[id];
    const after = next[id];
    if (!after) return false;
    if (!before) return true;
    return before.x !== after.x || before.y !== after.y;
  });
  if (changed) writeWorkshopFrontHallLayout(state.root, next);
  return next;
}

export function layoutBoardDefault(
  state: WorkshopFrontHallBoardState,
  existing?: WorkshopFrontHallLayoutMap | null,
): WorkshopFrontHallLayoutMap {
  const next: WorkshopFrontHallLayoutMap = { ...parseWorkshopFrontHallLayout(existing || {}) };
  const frames = [...new Set((state.frames || []).map((rel) => toPosixRel(rel)))];
  frames.sort((a, b) => {
    if (a === b) return 0;
    if (a === '') return -1;
    if (b === '') return 1;
    return a.localeCompare(b);
  });
  const byFolder = new Map<string, NonNullable<WorkshopFrontHallBoardState['nodes']>>();
  for (const node of state.nodes || []) {
    if (!node?.id) continue;
    const folderRel = toPosixRel(node.folderRel);
    const list = byFolder.get(folderRel);
    if (list) list.push(node);
    else byFolder.set(folderRel, [node]);
  }
  let cursorX = 0;
  for (const folderRel of frames) {
    const frameId = workshopFrontHallFrameId(state.root, folderRel);
    const nodes = byFolder.get(folderRel) || [];
    const metrics = gridMetrics(nodes.length);
    if (!next[frameId]) {
      next[frameId] = { x: cursorX, y: 0, width: metrics.width, height: metrics.height };
    }
    const origin = next[frameId];
    nodes.forEach((node, index) => {
      if (next[node.id]) return;
      const col = index % metrics.cols;
      const row = Math.floor(index / metrics.cols);
      next[node.id] = {
        x: origin.x + WRAP_PAD + col * (FILE_W + NODE_GAP),
        y: origin.y + WRAP_TOP + row * (FILE_H + NODE_GAP),
      };
    });
    cursorX = Math.max(cursorX, origin.x + (origin.width || metrics.width) + FRAME_MARGIN);
  }
  const leftovers = (state.nodes || []).filter((node) => node?.id && !next[node.id]);
  if (leftovers.length) {
    const origin = next[workshopFrontHallFrameId(state.root, '')] || { x: 0, y: 0 };
    const metrics = gridMetrics(leftovers.length);
    leftovers.forEach((node, index) => {
      const col = index % metrics.cols;
      const row = Math.floor(index / metrics.cols);
      next[node.id] = {
        x: origin.x + WRAP_PAD + col * (FILE_W + NODE_GAP),
        y: origin.y + WRAP_TOP + row * (FILE_H + NODE_GAP),
      };
    });
  }
  return next;
}

type FrontHallPushBox = {
  id: string;
  width?: number;
  height?: number;
  folderRel?: string;
};

type PackedBox = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  folderRel: string;
};

type GroupCluster = {
  folderRel: string;
  group: PackedBox;
  files: PackedBox[];
};

function fileSize(extra?: FrontHallPushBox): { w: number; h: number } {
  return {
    w: extra?.width && extra.width > 0 ? extra.width : FILE_W,
    h: extra?.height && extra.height > 0 ? extra.height : FILE_H,
  };
}

function boxesOverlap(a: PackedBox, b: PackedBox, gap: number): boolean {
  return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
}

function pushPair(a: PackedBox, b: PackedBox, gap: number): boolean {
  if (!boxesOverlap(a, b, gap)) return false;
  const dx = a.x + a.w / 2 - (b.x + b.w / 2);
  const dy = a.y + a.h / 2 - (b.y + b.h / 2);
  const overlapX = (a.w + b.w) / 2 + gap - Math.abs(dx);
  const overlapY = (a.h + b.h) / 2 + gap - Math.abs(dy);
  if (overlapX <= 0 || overlapY <= 0) return false;
  if (overlapX < overlapY) {
    const dir = dx > 0 || (dx === 0 && a.id > b.id) ? 1 : -1;
    const step = overlapX / 2;
    a.x += dir * step;
    b.x -= dir * step;
  } else {
    const dir = dy > 0 || (dy === 0 && a.id > b.id) ? 1 : -1;
    const step = overlapY / 2;
    a.y += dir * step;
    b.y -= dir * step;
  }
  return true;
}

function fileInsideGroup(file: PackedBox, group: PackedBox): boolean {
  return (
    file.x >= group.x + WRAP_PAD - 0.5 &&
    file.y >= group.y + WRAP_TOP - 0.5 &&
    file.x + file.w <= group.x + group.w - WRAP_PAD + 0.5 &&
    file.y + file.h <= group.y + group.h - WRAP_PAD + 0.5
  );
}

function filesOverlap(files: PackedBox[]): boolean {
  for (let i = 0; i < files.length; i += 1) {
    for (let j = i + 1; j < files.length; j += 1) {
      if (boxesOverlap(files[i], files[j], PUSH_GAP)) return true;
    }
  }
  return false;
}

function gridFilesInGroup(group: PackedBox, files: PackedBox[]): void {
  const metrics = gridMetrics(files.length);
  group.w = Math.max(group.w, metrics.width);
  group.h = Math.max(group.h, metrics.height);
  files.forEach((file, index) => {
    const col = index % metrics.cols;
    const row = Math.floor(index / metrics.cols);
    file.x = group.x + WRAP_PAD + col * (FILE_W + NODE_GAP);
    file.y = group.y + WRAP_TOP + row * (FILE_H + NODE_GAP);
  });
}

function clampFileIntoGroup(file: PackedBox, group: PackedBox): void {
  const minX = group.x + WRAP_PAD;
  const minY = group.y + WRAP_TOP;
  const maxX = group.x + group.w - WRAP_PAD - file.w;
  const maxY = group.y + group.h - WRAP_PAD - file.h;
  file.x = Math.min(Math.max(file.x, minX), Math.max(minX, maxX));
  file.y = Math.min(Math.max(file.y, minY), Math.max(minY, maxY));
}

function placeFilesInGroup(group: PackedBox, files: PackedBox[]): void {
  if (!files.length) {
    group.w = Math.max(group.w, EMPTY_FRAME_W);
    group.h = Math.max(group.h, EMPTY_FRAME_H);
    return;
  }
  const metrics = gridMetrics(files.length);
  group.w = Math.max(group.w, metrics.width);
  group.h = Math.max(group.h, metrics.height);
  if (files.some((file) => !fileInsideGroup(file, group)) || filesOverlap(files)) {
    gridFilesInGroup(group, files);
  }
  for (let iter = 0; iter < PUSH_ITERS; iter += 1) {
    let moved = false;
    for (let i = 0; i < files.length; i += 1) {
      for (let j = i + 1; j < files.length; j += 1) {
        if (pushPair(files[i], files[j], PUSH_GAP)) moved = true;
      }
    }
    for (const file of files) clampFileIntoGroup(file, group);
    if (!moved && !filesOverlap(files)) break;
  }
  if (filesOverlap(files)) gridFilesInGroup(group, files);
}

function moveCluster(cluster: GroupCluster, dx: number, dy: number): void {
  if (!dx && !dy) return;
  cluster.group.x += dx;
  cluster.group.y += dy;
  for (const file of cluster.files) {
    file.x += dx;
    file.y += dy;
  }
}

/** Groups push apart as rigid clusters. Not used on open or drag; call explicitly if a tidy pass is needed. */
export function pushApartFrontHallLayout(
  state: WorkshopFrontHallBoardState,
  layout: WorkshopFrontHallLayoutMap,
  extras: FrontHallPushBox[] = [],
): WorkshopFrontHallLayoutMap {
  const next = parseWorkshopFrontHallLayout(layout);
  const root = String(state.root || '').trim();
  const frames = [...new Set((state.frames || []).map((rel) => toPosixRel(rel)))];
  const extraById = new Map(extras.map((item) => [item.id, item]));
  const filesByFolder = new Map<string, PackedBox[]>();
  const addFile = (id: string, folderRel: string, extra?: FrontHallPushBox) => {
    const pose = next[id] || { x: 0, y: 0 };
    const size = fileSize(extra);
    const box: PackedBox = { id, x: pose.x, y: pose.y, w: size.w, h: size.h, folderRel };
    const list = filesByFolder.get(folderRel);
    if (list) list.push(box);
    else filesByFolder.set(folderRel, [box]);
  };
  for (const node of state.nodes || []) {
    if (!node?.id) continue;
    addFile(node.id, toPosixRel(node.folderRel), extraById.get(node.id));
  }
  const frameIds = new Set(frames.map((rel) => workshopFrontHallFrameId(root, rel)));
  for (const extra of extras) {
    if (!extra?.id || frameIds.has(extra.id)) continue;
    if ((state.nodes || []).some((node) => node.id === extra.id)) continue;
    addFile(extra.id, toPosixRel(extra.folderRel || ''), extra);
  }
  const clusters: GroupCluster[] = frames.map((folderRel) => {
    const frameId = workshopFrontHallFrameId(root, folderRel);
    const pose = next[frameId] || { x: 0, y: 0 };
    const files = filesByFolder.get(folderRel) || [];
    const metrics = gridMetrics(files.length);
    const group: PackedBox = {
      id: frameId,
      x: pose.x,
      y: pose.y,
      w: pose.width || metrics.width,
      h: pose.height || metrics.height,
      folderRel,
    };
    placeFilesInGroup(group, files);
    return { folderRel, group, files };
  });
  for (let iter = 0; iter < PUSH_ITERS; iter += 1) {
    let moved = false;
    for (let i = 0; i < clusters.length; i += 1) {
      for (let j = i + 1; j < clusters.length; j += 1) {
        const a = clusters[i];
        const b = clusters[j];
        const ax = a.group.x;
        const ay = a.group.y;
        const bx = b.group.x;
        const by = b.group.y;
        if (!pushPair(a.group, b.group, PUSH_GAP)) continue;
        const dax = a.group.x - ax;
        const day = a.group.y - ay;
        const dbx = b.group.x - bx;
        const dby = b.group.y - by;
        a.group.x = ax;
        a.group.y = ay;
        b.group.x = bx;
        b.group.y = by;
        moveCluster(a, dax, day);
        moveCluster(b, dbx, dby);
        moved = true;
      }
    }
    if (!moved) break;
  }
  for (const cluster of clusters) {
    const prev = next[cluster.group.id] || { x: cluster.group.x, y: cluster.group.y };
    next[cluster.group.id] = {
      ...prev,
      x: cluster.group.x,
      y: cluster.group.y,
      width: cluster.group.w,
      height: cluster.group.h,
    };
    for (const file of cluster.files) {
      const filePrev = next[file.id] || { x: file.x, y: file.y };
      next[file.id] = { ...filePrev, x: file.x, y: file.y };
    }
  }
  return next;
}
