import {
  isWorkshopBrowserLibraryRoot,
  isWorkshopRecycleRoot,
  parentRel,
  toPosixRel,
  WORKSHOP_BROWSER_LIBRARY_LABEL,
  WORKSHOP_RECYCLE_LIBRARY_LABEL,
} from './workshopFileTree';

export const WORKSHOP_NAV_HISTORY_CAP = 50;

export type WorkshopNavLoc = {
  root: string;
  rel: string;
  groupId: string | null;
};

export type WorkshopNavHistory = {
  entries: WorkshopNavLoc[];
  index: number;
};

export type WorkshopCanvasKindFilter = 'all' | 'image' | 'model3d' | 'video' | 'text' | 'file';

export type WorkshopCanvasKindSource = {
  isGroup?: boolean;
  assetKind?: string | null;
};

export type WorkshopNavCrumb = {
  id: string;
  label: string;
  loc: WorkshopNavLoc;
};

export function normalizeWorkshopNavLoc(loc: {
  root?: string | null;
  rel?: string | null;
  groupId?: string | null;
}): WorkshopNavLoc {
  return {
    root: String(loc.root || '').trim(),
    rel: toPosixRel(String(loc.rel || '')),
    groupId: String(loc.groupId || '').trim() || null,
  };
}

export function sameWorkshopNavLoc(a: WorkshopNavLoc, b: WorkshopNavLoc): boolean {
  const left = normalizeWorkshopNavLoc(a);
  const right = normalizeWorkshopNavLoc(b);
  return left.root === right.root && left.rel === right.rel && left.groupId === right.groupId;
}

export function emptyWorkshopNavHistory(initial?: {
  root?: string | null;
  rel?: string | null;
  groupId?: string | null;
}): WorkshopNavHistory {
  return { entries: [normalizeWorkshopNavLoc(initial || {})], index: 0 };
}

export function workshopNavCurrent(history: WorkshopNavHistory): WorkshopNavLoc {
  const loc = history.entries[history.index];
  return loc ? normalizeWorkshopNavLoc(loc) : normalizeWorkshopNavLoc({});
}

export function pushWorkshopNav(history: WorkshopNavHistory, next: WorkshopNavLoc): WorkshopNavHistory {
  const loc = normalizeWorkshopNavLoc(next);
  const cur = history.entries[history.index];
  if (cur && sameWorkshopNavLoc(cur, loc)) return history;
  const prev = history.entries.slice(0, Math.max(0, history.index) + 1);
  prev.push(loc);
  while (prev.length > WORKSHOP_NAV_HISTORY_CAP) prev.shift();
  return { entries: prev, index: prev.length - 1 };
}

export function workshopNavCanBack(history: WorkshopNavHistory): boolean {
  return history.index > 0;
}

export function workshopNavCanForward(history: WorkshopNavHistory): boolean {
  return history.index >= 0 && history.index < history.entries.length - 1;
}

export function workshopNavBack(history: WorkshopNavHistory): WorkshopNavHistory {
  if (!workshopNavCanBack(history)) return history;
  return { entries: history.entries, index: history.index - 1 };
}

export function workshopNavForward(history: WorkshopNavHistory): WorkshopNavHistory {
  if (!workshopNavCanForward(history)) return history;
  return { entries: history.entries, index: history.index + 1 };
}

export function workshopNavCanUp(loc: WorkshopNavLoc): boolean {
  const n = normalizeWorkshopNavLoc(loc);
  if (n.groupId) return true;
  return Boolean(n.rel);
}

export function workshopNavUpLoc(
  loc: WorkshopNavLoc,
  parentGroupId: string | null = null,
): WorkshopNavLoc | null {
  const n = normalizeWorkshopNavLoc(loc);
  if (n.groupId) {
    return { root: n.root, rel: n.rel, groupId: parentGroupId };
  }
  if (!n.rel) return null;
  return { root: n.root, rel: parentRel(n.rel), groupId: null };
}

export function workshopNavRootLabel(
  root: string,
  roots: Array<{ root: string; label: string }> = [],
): string {
  if (isWorkshopBrowserLibraryRoot(root)) return WORKSHOP_BROWSER_LIBRARY_LABEL;
  if (isWorkshopRecycleRoot(root)) return WORKSHOP_RECYCLE_LIBRARY_LABEL;
  const hit = roots.find((r) => r.root === root);
  if (hit?.label) return String(hit.label);
  const posix = String(root || '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '');
  const name = posix.split('/').filter(Boolean).pop();
  return name || posix || '文件夹';
}

export function workshopBreadcrumbSegments(args: {
  loc: WorkshopNavLoc;
  rootLabel: string;
  groupPath?: Array<{ id: string; label: string }>;
}): WorkshopNavCrumb[] {
  const loc = normalizeWorkshopNavLoc(args.loc);
  const root: WorkshopNavCrumb = {
    id: `root:${loc.root}`,
    label: args.rootLabel,
    loc: { root: loc.root, rel: '', groupId: null },
  };
  const out = [root];
  const groupPath = Array.isArray(args.groupPath) ? args.groupPath : [];
  if (loc.groupId && groupPath.length) {
    for (const g of groupPath) {
      out.push({
        id: `group:${g.id}`,
        label: g.label,
        loc: { root: loc.root, rel: loc.rel, groupId: g.id },
      });
    }
    return out;
  }
  const parts = toPosixRel(loc.rel).split('/').filter(Boolean);
  let acc = '';
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    out.push({
      id: `rel:${loc.root}:${acc}`,
      label: part,
      loc: { root: loc.root, rel: acc, groupId: null },
    });
  }
  return out;
}

export function workshopCanvasKindOf(
  asset: WorkshopCanvasKindSource,
): 'folder' | Exclude<WorkshopCanvasKindFilter, 'all'> {
  if (asset.isGroup) return 'folder';
  const k = String(asset.assetKind || '');
  if (k === 'image' || k === 'model3d' || k === 'text' || k === 'video') return k;
  return 'file';
}

export function workshopCanvasKindMatches(
  asset: WorkshopCanvasKindSource,
  filter: WorkshopCanvasKindFilter,
): boolean {
  if (!filter || filter === 'all') return true;
  const k = workshopCanvasKindOf(asset);
  return k === 'folder' || k === filter;
}

export function countWorkshopCanvasKinds(
  assets: WorkshopCanvasKindSource[],
): Record<WorkshopCanvasKindFilter, number> {
  const counts: Record<WorkshopCanvasKindFilter, number> = {
    all: Array.isArray(assets) ? assets.length : 0,
    image: 0,
    model3d: 0,
    video: 0,
    text: 0,
    file: 0,
  };
  for (const asset of Array.isArray(assets) ? assets : []) {
    const k = workshopCanvasKindOf(asset);
    if (k === 'folder') continue;
    counts[k] += 1;
  }
  return counts;
}

export function filterWorkshopCanvasByKind<T extends WorkshopCanvasKindSource>(
  assets: T[],
  filter: WorkshopCanvasKindFilter,
): T[] {
  if (!Array.isArray(assets)) return [];
  if (!filter || filter === 'all') return assets;
  return assets.filter((asset) => workshopCanvasKindMatches(asset, filter));
}
