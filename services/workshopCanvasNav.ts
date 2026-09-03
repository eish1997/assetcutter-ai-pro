import { readLocalJson, scopedStorageKey, writeLocalJson } from './clientPersist';
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

export type WorkshopCanvasKindId = 'image' | 'model3d' | 'video' | 'text' | 'file';
export type WorkshopCanvasKindFilter = WorkshopCanvasKindId;

export const WORKSHOP_CANVAS_KIND_IDS: WorkshopCanvasKindId[] = ['image', 'model3d', 'video', 'text', 'file'];
export const DEFAULT_WORKSHOP_CANVAS_KINDS: WorkshopCanvasKindId[] = ['image', 'model3d', 'video', 'text'];

export type WorkshopCanvasKindSource = {
  isGroup?: boolean;
  assetKind?: string | null;
  /** 作坊文件夹卡：子树里出现过的种类。缺省时筛选仍显示（工作台组）。 */
  containedKinds?: Iterable<string> | null;
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
): 'folder' | WorkshopCanvasKindId {
  if (asset.isGroup) return 'folder';
  const k = String(asset.assetKind || '');
  if (k === 'image' || k === 'model3d' || k === 'text' || k === 'video') return k;
  return 'file';
}

export function workshopCanvasKindSet(kinds: Iterable<string> | null | undefined): Set<WorkshopCanvasKindId> {
  const out = new Set<WorkshopCanvasKindId>();
  for (const raw of kinds || []) {
    if ((WORKSHOP_CANVAS_KIND_IDS as string[]).includes(raw)) out.add(raw as WorkshopCanvasKindId);
  }
  return out;
}

export function workshopCanvasFolderMatchesKinds(
  asset: WorkshopCanvasKindSource,
  kinds: Iterable<string> | null | undefined,
): boolean {
  const selected = workshopCanvasKindSet(kinds);
  if (!selected.size) return false;
  if (asset.containedKinds == null) return true;
  const contained = workshopCanvasKindSet(asset.containedKinds);
  for (const id of contained) {
    if (selected.has(id)) return true;
  }
  return false;
}

export function workshopCanvasKindMatches(
  asset: WorkshopCanvasKindSource,
  kinds: Iterable<string> | null | undefined,
): boolean {
  const k = workshopCanvasKindOf(asset);
  if (k === 'folder') return workshopCanvasFolderMatchesKinds(asset, kinds);
  return workshopCanvasKindSet(kinds).has(k);
}

export function countWorkshopCanvasKinds(
  assets: WorkshopCanvasKindSource[],
): Record<WorkshopCanvasKindId, number> {
  const counts: Record<WorkshopCanvasKindId, number> = {
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
  kinds: Iterable<string> | null | undefined,
): T[] {
  if (!Array.isArray(assets)) return [];
  const set = workshopCanvasKindSet(kinds);
  return assets.filter((asset) => {
    const k = workshopCanvasKindOf(asset);
    return k === 'folder' ? workshopCanvasFolderMatchesKinds(asset, set) : set.has(k);
  });
}

export function toggleWorkshopCanvasKind(
  kinds: Iterable<string> | null | undefined,
  id: WorkshopCanvasKindId,
): WorkshopCanvasKindId[] {
  const set = workshopCanvasKindSet(kinds);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  return WORKSHOP_CANVAS_KIND_IDS.filter((k) => set.has(k));
}

export function isolateWorkshopCanvasKind(id: WorkshopCanvasKindId): WorkshopCanvasKindId[] {
  return [id];
}

export const WORKSHOP_CANVAS_LIST_PREFS_KEY = 'workshopCanvasListPrefs';

export type WorkshopCanvasSortKey = 'name' | 'created' | 'modified' | 'size' | 'folder';
export type WorkshopCanvasSortDir = 'asc' | 'desc';

export type WorkshopCanvasListPrefs = {
  sortKey: WorkshopCanvasSortKey;
  sortDir: WorkshopCanvasSortDir;
  flatten: boolean;
  hideFormatBadges: boolean;
  groupByType: boolean;
  kinds: WorkshopCanvasKindId[];
};

export type WorkshopCanvasSortable = {
  kind?: string;
  name?: string;
  title?: string;
  size?: number;
  mtimeMs?: number;
  birthtimeMs?: number;
  assetKind?: string | null;
  isGroup?: boolean;
};

const SORT_KEYS = new Set<WorkshopCanvasSortKey>(['name', 'created', 'modified', 'size', 'folder']);
const TYPE_ORDER = ['folder', 'image', 'model3d', 'video', 'text', 'file'];

export function defaultWorkshopCanvasListPrefs(): WorkshopCanvasListPrefs {
  return {
    sortKey: 'folder',
    sortDir: 'asc',
    flatten: false,
    hideFormatBadges: false,
    groupByType: false,
    kinds: DEFAULT_WORKSHOP_CANVAS_KINDS.slice(),
  };
}

export function parseWorkshopCanvasListPrefs(raw: unknown): WorkshopCanvasListPrefs {
  const fallback = defaultWorkshopCanvasListPrefs();
  if (!raw || typeof raw !== 'object') return fallback;
  const o = raw as Record<string, unknown>;
  const key = String(o.sortKey || '');
  const kinds = Array.isArray(o.kinds)
    ? WORKSHOP_CANVAS_KIND_IDS.filter((id) => o.kinds.includes(id))
    : fallback.kinds.slice();
  return {
    sortKey: SORT_KEYS.has(key as WorkshopCanvasSortKey) ? (key as WorkshopCanvasSortKey) : fallback.sortKey,
    sortDir: o.sortDir === 'desc' ? 'desc' : 'asc',
    flatten: o.flatten === true,
    hideFormatBadges: o.hideFormatBadges === true,
    groupByType: o.groupByType === true,
    kinds,
  };
}

export function readWorkshopCanvasListPrefs(scope: string | null | undefined): WorkshopCanvasListPrefs {
  return readLocalJson(
    scopedStorageKey(WORKSHOP_CANVAS_LIST_PREFS_KEY, scope),
    defaultWorkshopCanvasListPrefs(),
    (parsed) => parseWorkshopCanvasListPrefs(parsed),
  );
}

export function writeWorkshopCanvasListPrefs(
  scope: string | null | undefined,
  prefs: WorkshopCanvasListPrefs,
): void {
  writeLocalJson(scopedStorageKey(WORKSHOP_CANVAS_LIST_PREFS_KEY, scope), parseWorkshopCanvasListPrefs(prefs));
}

export function filterWorkshopCanvasByName<T extends WorkshopCanvasSortable>(items: T[], query: string): T[] {
  if (!Array.isArray(items)) return [];
  const q = String(query || '').trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => {
    const title = String(item.title || '').toLowerCase();
    const name = String(item.name || '').toLowerCase();
    return title.includes(q) || name.includes(q);
  });
}

function canvasItemLabel(item: WorkshopCanvasSortable): string {
  return String(item.title || item.name || '');
}

function canvasItemTypeRank(item: WorkshopCanvasSortable): number {
  const kind = item.kind === 'folder' || item.isGroup ? 'folder' : workshopCanvasKindOf(item);
  const idx = TYPE_ORDER.indexOf(kind);
  return idx < 0 ? TYPE_ORDER.length : idx;
}

function compareBySortKey(a: WorkshopCanvasSortable, b: WorkshopCanvasSortable, key: WorkshopCanvasSortKey): number {
  if (key === 'name') {
    return canvasItemLabel(a).localeCompare(canvasItemLabel(b), undefined, { numeric: true, sensitivity: 'base' });
  }
  if (key === 'created') {
    return (Number(a.birthtimeMs) || Number(a.mtimeMs) || 0) - (Number(b.birthtimeMs) || Number(b.mtimeMs) || 0);
  }
  if (key === 'modified') {
    return (Number(a.mtimeMs) || 0) - (Number(b.mtimeMs) || 0);
  }
  if (key === 'size') {
    return (Number(a.size) || 0) - (Number(b.size) || 0);
  }
  const aFolder = a.kind === 'folder' || a.isGroup === true;
  const bFolder = b.kind === 'folder' || b.isGroup === true;
  if (aFolder !== bFolder) return aFolder ? -1 : 1;
  return canvasItemLabel(a).localeCompare(canvasItemLabel(b), undefined, { numeric: true, sensitivity: 'base' });
}

export function sortWorkshopCanvasItems<T extends WorkshopCanvasSortable>(
  items: T[],
  prefs: WorkshopCanvasListPrefs,
): T[] {
  if (!Array.isArray(items)) return [];
  const parsed = parseWorkshopCanvasListPrefs(prefs);
  const dir = parsed.sortDir === 'desc' ? -1 : 1;
  return items.slice().sort((a, b) => {
    if (parsed.groupByType) {
      const typeCmp = canvasItemTypeRank(a) - canvasItemTypeRank(b);
      if (typeCmp) return typeCmp;
    }
    const cmp = compareBySortKey(a, b, parsed.sortKey);
    return cmp === 0
      ? canvasItemLabel(a).localeCompare(canvasItemLabel(b), undefined, { numeric: true, sensitivity: 'base' })
      : cmp * dir;
  });
}
