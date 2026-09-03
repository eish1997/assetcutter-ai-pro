import type { WorkflowAsset } from '../types';

export const WORKSHOP_FOLDERS_PANE_WIDTH_PX = 220;
/** 可见格缩略图 IPC 并发（不是整层一次拉，也不是每次 8 张再等 effect 重跑） */
export const WORKSHOP_THUMB_IPC_PARALLEL = 16;
export const WORKSHOP_FILE_ASSET_PREFIX = 'wsfile:';
export const WORKSHOP_BROWSER_LIBRARY_ROOT = 'ac-browser:';
export const WORKSHOP_BROWSER_LIBRARY_LABEL = '浏览器资产';
export const WORKSHOP_RECYCLE_LIBRARY_ROOT = 'ac-recycle:';
export const WORKSHOP_RECYCLE_LIBRARY_LABEL = '回收站';
export const WORKSHOP_RECYCLE_DIR = 'recycle';

export function isWorkshopBrowserLibraryRoot(root: string | null | undefined): boolean {
  return String(root || '').trim() === WORKSHOP_BROWSER_LIBRARY_ROOT;
}

export function isWorkshopRecycleRoot(root: string | null | undefined): boolean {
  return String(root || '').trim() === WORKSHOP_RECYCLE_LIBRARY_ROOT;
}

/** 浏览器资产 / 回收站：左树钉死，不能「+」挂、不能右键拿掉 */
export function isWorkshopPinnedTreeRoot(root: string | null | undefined): boolean {
  return isWorkshopBrowserLibraryRoot(root) || isWorkshopRecycleRoot(root);
}

/** 可在当前根新建 / 导入 / 生成；回收站只看已删文件 */
export function workshopRootAllowsCreate(root: string | null | undefined): boolean {
  const id = String(root || '').trim();
  return Boolean(id) && !isWorkshopPinnedTreeRoot(id);
}

export type WorkshopEntryKind = 'dir' | 'image' | 'model' | 'file' | 'text' | 'video';

export type WorkshopDirEntry = {
  name: string;
  rel: string;
  kind: WorkshopEntryKind;
  size: number;
  mtimeMs: number;
  birthtimeMs?: number;
  isPackage?: boolean;
};

export type WorkshopRootInfo = {
  root: string;
  label: string;
};

export function workshopBrowserLibraryRoot(): WorkshopRootInfo {
  return { root: WORKSHOP_BROWSER_LIBRARY_ROOT, label: WORKSHOP_BROWSER_LIBRARY_LABEL };
}

export function workshopRecycleLibraryRoot(): WorkshopRootInfo {
  return { root: WORKSHOP_RECYCLE_LIBRARY_ROOT, label: WORKSHOP_RECYCLE_LIBRARY_LABEL };
}

export type WorkshopFileState = {
  ok: boolean;
  roots?: WorkshopRootInfo[];
  root?: string;
  label?: string;
  workspaceDir?: string;
  openRoot?: string;
  openRel?: string;
  canceled?: boolean;
  error?: string;
};

export type WorkshopListResult = {
  ok: boolean;
  rel?: string;
  entries?: WorkshopDirEntry[];
  items?: import('./workshopAssetPackage').WorkshopCanvasItem[];
  truncated?: boolean;
  error?: string;
};

export type WorkshopThumbResult = {
  ok: boolean;
  kind?: WorkshopEntryKind;
  status?: 'ready' | 'placeholder';
  dataUrl?: string;
  rel?: string;
  error?: string;
};

export type WorkshopFileSourceApi = {
  listWorkshopDir?: (payload?: {
    root?: string;
    rel?: string;
    assetsOnly?: boolean;
    includeSubfolders?: boolean;
  }) => Promise<WorkshopListResult>;
  pickWorkshopRoot?: () => Promise<WorkshopFileState>;
  removeWorkshopRoot?: (payload: { root: string }) => Promise<WorkshopFileState>;
  getWorkshopFileState?: () => Promise<WorkshopFileState>;
  getWorkshopThumb?: (payload: {
    root?: string;
    rel?: string;
    assetId?: string;
    fileId?: string;
    packageRel?: string;
  }) => Promise<WorkshopThumbResult>;
  putWorkshopThumb?: (payload: {
    root?: string;
    rel?: string;
    assetId?: string;
    fileId?: string;
    packageRel?: string;
    dataUrl: string;
  }) => Promise<{ ok: boolean; rel?: string; error?: string }>;
  readWorkshopFile?: (payload: {
    root?: string;
    rel?: string;
    assetId?: string;
    fileId?: string;
    packageRel?: string;
  }) => Promise<{ ok: boolean; dataUrl?: string; rel?: string; assetId?: string; fileId?: string; error?: string }>;
  getWorkshopMedia?: (payload: {
    root?: string;
    rel?: string;
    assetId?: string;
    fileId?: string;
    packageRel?: string;
  }) => Promise<{
    ok: boolean;
    kind?: string;
    mime?: string;
    url?: string;
    textPreview?: string;
    size?: number;
    rel?: string;
    assetId?: string;
    fileId?: string;
    error?: string;
  }>;
  writeWorkshopResult?: (payload: {
    root?: string;
    assetId: string;
    packageRel?: string;
    dataUrl: string;
    step?: string;
  }) => Promise<{ ok: boolean; assetId?: string; fileId?: string; displayFileId?: string; rel?: string; error?: string }>;
  createWorkshopPackage?: (payload: {
    root?: string;
    parentRel?: string;
    title?: string;
    originalDataUrl?: string;
    tags?: string[];
  }) => Promise<{
    ok: boolean;
    assetId?: string;
    packageRel?: string;
    checkoutRel?: string;
    fileId?: string;
    displayFileId?: string;
    faceFileId?: string;
    checkoutFileId?: string;
    error?: string;
  }>;
  createWorkshopCheckoutFile?: (payload: {
    root?: string;
    parentRel?: string;
    title?: string;
    ext?: string;
    body?: string;
    dataUrl?: string;
  }) => Promise<{ ok: boolean; rel?: string; name?: string; assetId?: string; error?: string }>;
  writeWorkshopCheckoutFile?: (payload: {
    root?: string;
    rel: string;
    body?: string;
    dataUrl?: string;
  }) => Promise<{ ok: boolean; rel?: string; error?: string }>;
  importWorkshopFiles?: (payload: {
    root?: string;
    parentRel?: string;
    items: Array<{ name: string; dataUrl?: string; absPath?: string }>;
  }) => Promise<{ ok: boolean; items?: Array<{ rel: string; skipped?: boolean }>; error?: string }>;
  mkdirWorkshopDir?: (payload: {
    root?: string;
    parentRel?: string;
    name?: string;
  }) => Promise<{ ok: boolean; rel?: string; name?: string; error?: string }>;
  revealWorkshopPath?: (payload: {
    root?: string;
    rel?: string;
  }) => Promise<{ ok: boolean; abs?: string; rel?: string; error?: string }>;
  resolveWorkshopAbs?: (payload: {
    root?: string;
    rel?: string;
  }) => Promise<{ ok: boolean; abs?: string; rel?: string; error?: string }>;
  renameWorkshopEntry?: (payload: {
    root?: string;
    rel: string;
    name: string;
  }) => Promise<{ ok: boolean; from?: string; to?: string; error?: string }>;
  moveWorkshopEntries?: (payload: {
    root?: string;
    destRel: string;
    rels?: string[];
    rel?: string;
  }) => Promise<{ ok: boolean; moved?: Array<{ from: string; to: string }>; error?: string }>;
  copyWorkshopEntries?: (payload: {
    root?: string;
    destRel?: string;
    rels?: string[];
    rel?: string;
  }) => Promise<{ ok: boolean; copied?: Array<{ from: string; to: string }>; error?: string }>;
  trashWorkshopEntries?: (payload: {
    root?: string;
    rels?: string[];
    rel?: string;
  }) => Promise<{ ok: boolean; rels?: string[]; error?: string }>;
  groupWorkshopEntries?: (payload: {
    root?: string;
    parentRel?: string;
    rels?: string[];
    name?: string;
  }) => Promise<{ ok: boolean; destRel?: string; error?: string }>;
  upgradeWorkshopLoose?: (payload: {
    root?: string;
    rel: string;
    dataUrl: string;
    step?: string;
    tags?: string[];
  }) => Promise<{
    ok: boolean;
    assetId?: string;
    fileId?: string;
    displayFileId?: string;
    faceFileId?: string;
    checkoutFileId?: string;
    rel?: string;
    checkoutRel?: string;
    packageRel?: string;
    error?: string;
  }>;
  applyWorkshopCheckout?: (payload: {
    root?: string;
    assetId?: string;
    rel?: string;
    fileId?: string;
  }) => Promise<{ ok: boolean; assetId?: string; fileId?: string; checkoutRel?: string; error?: string }>;
  setWorkshopFace?: (payload: {
    root?: string;
    assetId?: string;
    rel?: string;
    fileId?: string;
  }) => Promise<{ ok: boolean; assetId?: string; faceFileId?: string; error?: string }>;
  pickWorkshopWorkspace?: () => Promise<WorkshopFileState>;
  setWorkshopLibraryOpen?: (payload: { root?: string; rel?: string }) => Promise<WorkshopFileState>;
};

export function hasWorkbenchFileSourceApi(): boolean {
  if (typeof window === 'undefined') return false;
  const api = window.assetCutterWorkbench as WorkshopFileSourceApi | undefined;
  return typeof api?.listWorkshopDir === 'function';
}

export function workshopFileSourceApi(): WorkshopFileSourceApi | null {
  if (!hasWorkbenchFileSourceApi()) return null;
  return window.assetCutterWorkbench as WorkshopFileSourceApi;
}

export function toPosixRel(rel: string): string {
  return String(rel || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

export function parentRel(rel: string): string {
  const posix = toPosixRel(rel);
  if (!posix) return '';
  const i = posix.lastIndexOf('/');
  return i < 0 ? '' : posix.slice(0, i);
}

/** 当前夹的上一级；已在素材根则 null（不能移出已挂根） */
export function workshopMoveToParentDestRel(currentRel: string): string | null {
  const posix = toPosixRel(currentRel);
  if (!posix) return null;
  return parentRel(posix);
}

export function workshopFileAssetId(root: string, rel: string): string {
  return `${WORKSHOP_FILE_ASSET_PREFIX}${encodeURIComponent(String(root || ''))}/${toPosixRel(rel)}`;
}

export function workshopCardDiskRel(
  id: string,
  items?: Array<{ kind?: string; root?: string; rel?: string; assetId?: string }>,
): string | null {
  const parsedFile = parseWorkshopFileAssetId(id);
  if (parsedFile) return parsedFile.rel || null;
  const raw = String(id || '');
  if (!raw.startsWith('wspkg:')) return null;
  const rest = raw.slice('wspkg:'.length);
  const slash = rest.indexOf('/');
  const encRoot = slash < 0 ? rest : rest.slice(0, slash);
  const assetId = slash < 0 ? '' : rest.slice(slash + 1);
  let parsedRoot = '';
  try {
    parsedRoot = decodeURIComponent(encRoot);
  } catch {
    return null;
  }
  const hit = (Array.isArray(items) ? items : []).find(
    (row) => row && row.kind === 'package' && row.assetId === assetId && row.root === parsedRoot,
  );
  return hit?.rel ? toPosixRel(hit.rel) : null;
}

export function parseWorkshopFileAssetId(id: string): { root: string; rel: string } | null {
  const raw = String(id || '');
  if (!raw.startsWith(WORKSHOP_FILE_ASSET_PREFIX)) return null;
  const rest = raw.slice(WORKSHOP_FILE_ASSET_PREFIX.length);
  const slash = rest.indexOf('/');
  const encRoot = slash < 0 ? rest : rest.slice(0, slash);
  const rel = slash < 0 ? '' : rest.slice(slash + 1);
  try {
    const root = decodeURIComponent(encRoot);
    if (!root) return null;
    return { root, rel: toPosixRel(rel) };
  } catch {
    return null;
  }
}

export function selectedRelFromAssetIds(
  ids: Iterable<string>,
  activeRoot: string,
  items?: import('./workshopAssetPackage').WorkshopCanvasItem[],
): string | null {
  const root = String(activeRoot || '').trim();
  const canvas = Array.isArray(items) ? items : [];
  for (const id of ids) {
    const raw = String(id || '');
    if (raw.startsWith('wspkg:')) {
      const rest = raw.slice('wspkg:'.length);
      const slash = rest.indexOf('/');
      const encRoot = slash < 0 ? rest : rest.slice(0, slash);
      const assetId = slash < 0 ? '' : rest.slice(slash + 1);
      try {
        const parsedRoot = decodeURIComponent(encRoot);
        if (root && parsedRoot !== root) continue;
        const item = canvas.find(
          (row) => row && row.kind === 'package' && row.assetId === assetId && row.root === parsedRoot,
        );
        if (item?.displayRel) return item.displayRel;
        if (item?.rel) return item.rel;
      } catch {
        continue;
      }
      continue;
    }
    const parsed = parseWorkshopFileAssetId(raw);
    if (!parsed) continue;
    if (root && parsed.root !== root) continue;
    return parsed.rel || null;
  }
  return null;
}

export function workshopEntriesToWorkflowAssets(
  entries: WorkshopDirEntry[] | null | undefined,
  args: { root: string; originalById?: Record<string, string> },
): WorkflowAsset[] {
  const root = String(args.root || '').trim();
  if (!root) return [];
  const originalById = args.originalById || {};
  const out: WorkflowAsset[] = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || entry.kind === 'dir') continue;
    const id = workshopFileAssetId(root, entry.rel);
    const assetKind: WorkflowAsset['assetKind'] =
      entry.kind === 'model'
        ? 'model3d'
        : entry.kind === 'image'
          ? 'image'
          : entry.kind === 'text'
            ? 'text'
            : entry.kind === 'video'
              ? 'video'
              : 'file';
    out.push({
      id,
      assetKind,
      original: originalById[id] || '',
      displayKey: 'original',
      results: {},
      resultOrder: [],
      archived: false,
      hiddenInGrid: false,
      createdAt: Math.floor(Number(entry.mtimeMs) || 0),
      textTitle: String(entry.name || ''),
      ...(entry.kind === 'model' ? { modelSourceName: String(entry.name || '') } : {}),
    });
  }
  return out;
}

export function applyWorkshopFileState(
  st: WorkshopFileState | null | undefined,
): { roots: WorkshopRootInfo[]; activeRoot: string; openRel: string } {
  const roots = Array.isArray(st?.roots) ? st.roots.filter((r) => r && r.root) : [];
  const openRoot = String(st?.openRoot || '').trim();
  const openRel = String(st?.openRel || '').trim();
  if (openRoot && roots.some((r) => r.root === openRoot)) {
    return { roots, activeRoot: openRoot, openRel };
  }
  if (roots.length) return { roots, activeRoot: roots[0].root, openRel: '' };
  const root = String(st?.root || '').trim();
  if (!root) return { roots: [], activeRoot: '', openRel: '' };
  return { roots: [{ root, label: String(st?.label || root) }], activeRoot: root, openRel: '' };
}
