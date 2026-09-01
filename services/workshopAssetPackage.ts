import type { WorkflowAsset } from '../types';
import { toPosixRel, workshopFileAssetId } from './workshopFileTree';
import {
  isWorkshopPlayableMediaUrl,
  isWorkshopTextPreviewName,
  workshopModelFormatFromName,
} from './workshopPreviewKind';

export const AC_ASSET_MANIFEST = 'ac-asset.json';
export const WORKSHOP_PACKAGE_CARD_PREFIX = 'wspkg:';

export type AcAssetFileRole = 'original' | 'result';

export type AcAssetFileRec = {
  name: string;
  role: AcAssetFileRole;
  step?: string;
};

export type AcAssetDoc = {
  v: number;
  id: string;
  title: string;
  displayFileId: string;
  files: Record<string, AcAssetFileRec>;
  resultOrder: string[];
  tags: string[];
};

export type WorkshopCardPointer =
  | { kind: 'package'; root: string; assetId: string; fileId?: string }
  | { kind: 'loose'; root: string; rel: string };

export type WorkshopCanvasItem = {
  kind: 'package' | 'loose' | 'folder';
  root: string;
  rel: string;
  name: string;
  assetKind: 'image' | 'model3d' | 'file' | 'text' | 'video';
  size: number;
  mtimeMs: number;
  assetId?: string;
  displayFileId?: string;
  displayRel?: string;
  title?: string;
  resultOrder?: string[];
  files?: Record<string, AcAssetFileRec>;
  faceFileId?: string;
  checkoutFileId?: string;
  previewRels?: string[];
};

export function utf8FromDataUrl(dataUrl: string): string {
  const s = String(dataUrl || '');
  const comma = s.indexOf(',');
  if (!s.startsWith('data:') || comma < 0) return '';
  const meta = s.slice(5, comma);
  const body = s.slice(comma + 1);
  try {
    if (meta.includes(';base64')) {
      if (typeof Buffer !== 'undefined') return Buffer.from(body, 'base64').toString('utf8');
      const bin = atob(body);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder().decode(bytes);
    }
    return decodeURIComponent(body);
  } catch {
    return '';
  }
}

export function newWorkshopId(): string {
  const bytes = new Uint8Array(4);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 4; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function parseAcAssetDoc(raw: unknown): AcAssetDoc | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id || '').trim();
  if (!id) return null;
  const filesIn = o.files && typeof o.files === 'object' ? (o.files as Record<string, unknown>) : {};
  const files: Record<string, AcAssetFileRec> = {};
  for (const [fid, rec] of Object.entries(filesIn)) {
    if (!fid || !rec || typeof rec !== 'object') continue;
    const name = String((rec as AcAssetFileRec).name || '').trim();
    if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) continue;
    const role = (rec as AcAssetFileRec).role === 'result' ? 'result' : 'original';
    const step = String((rec as AcAssetFileRec).step || '').trim();
    files[fid] = step ? { name, role, step } : { name, role };
  }
  if (!Object.keys(files).length) return null;
  const displayFileId = String(o.displayFileId || '').trim() || Object.keys(files)[0];
  if (!files[displayFileId]) return null;
  const resultOrder = Array.isArray(o.resultOrder)
    ? o.resultOrder.map((x) => String(x || '').trim()).filter((x) => files[x])
    : [];
  const tags = Array.isArray(o.tags) ? o.tags.map((x) => String(x || '').trim()).filter(Boolean) : [];
  return {
    v: Number(o.v) > 0 ? Math.floor(Number(o.v)) : 1,
    id,
    title: String(o.title || id),
    displayFileId,
    files,
    resultOrder,
    tags,
  };
}

export function displayRelForDoc(packageRel: string, doc: AcAssetDoc): string {
  const rec = doc.files[doc.displayFileId];
  const name = rec?.name || '';
  const base = toPosixRel(packageRel);
  return base ? `${base}/${name}` : name;
}

export function fileRelForDoc(packageRel: string, doc: AcAssetDoc, fileId: string): string | null {
  const rec = doc.files[fileId];
  if (!rec) return null;
  const base = toPosixRel(packageRel);
  return base ? `${base}/${rec.name}` : rec.name;
}

export function workshopPackageCardId(root: string, assetId: string): string {
  return `${WORKSHOP_PACKAGE_CARD_PREFIX}${encodeURIComponent(String(root || ''))}/${String(assetId || '').trim()}`;
}

export function parseWorkshopCardId(id: string): WorkshopCardPointer | null {
  const raw = String(id || '');
  if (raw.startsWith(WORKSHOP_PACKAGE_CARD_PREFIX)) {
    const rest = raw.slice(WORKSHOP_PACKAGE_CARD_PREFIX.length);
    const slash = rest.indexOf('/');
    const encRoot = slash < 0 ? rest : rest.slice(0, slash);
    const assetId = slash < 0 ? '' : rest.slice(slash + 1);
    try {
      const root = decodeURIComponent(encRoot);
      if (!root || !assetId) return null;
      return { kind: 'package', root, assetId };
    } catch {
      return null;
    }
  }
  if (!raw.startsWith('wsfile:')) return null;
  const rest = raw.slice('wsfile:'.length);
  const slash = rest.indexOf('/');
  const encRoot = slash < 0 ? rest : rest.slice(0, slash);
  const rel = slash < 0 ? '' : rest.slice(slash + 1);
  try {
    const root = decodeURIComponent(encRoot);
    if (!root) return null;
    return { kind: 'loose', root, rel: toPosixRel(rel) };
  } catch {
    return null;
  }
}

export type WorkshopMediaHit = {
  url?: string;
  kind?: string;
  textPreview?: string;
};

function playableFieldsForCanvasItem(opts: {
  name: string;
  title: string;
  assetKind: WorkshopCanvasItem['assetKind'];
  stored: string;
  media: WorkshopMediaHit | undefined;
  textBodyFallback: string;
}): Pick<WorkflowAsset, 'original' | 'textBody' | 'modelSourceName' | 'stepModelUrls' | 'stepModelFormats'> {
  const mediaUrl = String(opts.media?.url || '').trim();
  const isText = opts.assetKind === 'text' || isWorkshopTextPreviewName(opts.title) || isWorkshopTextPreviewName(opts.name);
  const isVideo = opts.assetKind === 'video';
  const isModel = opts.assetKind === 'model3d';
  const textBody =
    opts.textBodyFallback ||
    String(opts.media?.textPreview || '').trim() ||
    (opts.stored.startsWith('data:') ? utf8FromDataUrl(opts.stored) : '');
  const playable = isWorkshopPlayableMediaUrl(mediaUrl)
    ? mediaUrl
    : isWorkshopPlayableMediaUrl(opts.stored)
      ? opts.stored
      : '';
  const modelFmt = isModel ? workshopModelFormatFromName(opts.name) || workshopModelFormatFromName(opts.title) : undefined;
  return {
    original: isText || isModel ? '' : isVideo ? playable : opts.stored,
    ...(isText ? { textBody } : {}),
    ...(isModel
      ? {
          modelSourceName: opts.name || opts.title,
          ...(playable
            ? {
                stepModelUrls: { original: [playable] },
                ...(modelFmt ? { stepModelFormats: { original: [modelFmt] } } : {}),
              }
            : {}),
        }
      : {}),
  };
}

export function workshopCanvasItemsToWorkflowAssets(
  items: WorkshopCanvasItem[] | null | undefined,
  args: {
    originalById?: Record<string, string>;
    faceById?: Record<string, string>;
    mediaById?: Record<string, WorkshopMediaHit>;
    textBodyById?: Record<string, string>;
  },
): WorkflowAsset[] {
  const originalById = args.originalById || {};
  const mediaById = args.mediaById || {};
  const textBodyById = args.textBodyById || {};
  const out: WorkflowAsset[] = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item) continue;
    if (item.kind === 'package' && item.assetId) {
      const id = workshopPackageCardId(item.root, item.assetId);
      const displayKey = String(item.displayFileId || 'original');
      const results: Record<string, string> = {};
      const resultOrder = Array.isArray(item.resultOrder) ? item.resultOrder.slice() : [];
      for (const fid of resultOrder) {
        const key = `${id}::${fid}`;
        if (originalById[key]) results[fid] = originalById[key];
      }
      const pkgTitle = String(item.title || item.name || item.assetId);
      const stored = originalById[id] || originalById[`${id}::${displayKey}`] || '';
      const playable = playableFieldsForCanvasItem({
        name: item.name,
        title: pkgTitle,
        assetKind: item.assetKind,
        stored,
        media: mediaById[id],
        textBodyFallback: textBodyById[id] || '',
      });
      out.push({
        id,
        assetKind: item.assetKind,
        original: playable.original,
        displayKey,
        results,
        resultOrder,
        archived: false,
        hiddenInGrid: false,
        createdAt: Math.floor(Number(item.mtimeMs) || 0),
        textTitle: pkgTitle,
        ...(playable.textBody !== undefined ? { textBody: playable.textBody } : {}),
        ...(playable.modelSourceName ? { modelSourceName: playable.modelSourceName } : {}),
        ...(playable.stepModelUrls ? { stepModelUrls: playable.stepModelUrls } : {}),
        ...(playable.stepModelFormats ? { stepModelFormats: playable.stepModelFormats } : {}),
      });
      continue;
    }
    if (item.kind === 'folder') {
      const id = workshopFileAssetId(item.root, item.rel);
      const previewRels = Array.isArray(item.previewRels) ? item.previewRels : [];
      out.push({
        id,
        isGroup: true,
        assetIds: previewRels.map((rel) => workshopFileAssetId(item.root, rel)),
        groupLabel: String(item.name || item.rel),
        original: '',
        displayKey: 'original',
        results: {},
        resultOrder: [],
        archived: false,
        hiddenInGrid: false,
        createdAt: Math.floor(Number(item.mtimeMs) || 0),
        textTitle: String(item.title || item.name || item.rel),
      });
      continue;
    }
    if (item.kind === 'loose') {
      const id = workshopFileAssetId(item.root, item.rel);
      const faceKey = String(args.faceById?.[id] || item.faceFileId || 'original').trim() || 'original';
      const resultOrder = Array.isArray(item.resultOrder) ? item.resultOrder.slice() : [];
      const results: Record<string, string> = {};
      for (const fid of resultOrder) {
        const key = `${id}::${fid}`;
        if (originalById[key]) results[fid] = originalById[key];
      }
      const stored = originalById[id] || originalById[`${id}::${faceKey}`] || '';
      const playable = playableFieldsForCanvasItem({
        name: item.name,
        title: String(item.title || item.name || item.rel),
        assetKind: item.assetKind,
        stored,
        media: mediaById[id],
        textBodyFallback: textBodyById[id] || '',
      });
      out.push({
        id,
        assetKind: item.assetKind,
        original: playable.original,
        displayKey: faceKey,
        results,
        resultOrder,
        archived: false,
        hiddenInGrid: false,
        createdAt: Math.floor(Number(item.mtimeMs) || 0),
        textTitle: String(item.title || item.name || item.rel),
        ...(playable.textBody !== undefined ? { textBody: playable.textBody } : {}),
        ...(playable.modelSourceName ? { modelSourceName: playable.modelSourceName } : {}),
        ...(playable.stepModelUrls ? { stepModelUrls: playable.stepModelUrls } : {}),
        ...(playable.stepModelFormats ? { stepModelFormats: playable.stepModelFormats } : {}),
      });
    }
  }
  return out;
}

export function workshopHostFilePayload(
  pointer: WorkshopCardPointer,
  opts?: { items?: WorkshopCanvasItem[]; fileId?: string },
): {
  root: string;
  rel?: string;
  assetId?: string;
  fileId?: string;
  packageRel?: string;
} {
  if (pointer.kind === 'loose') {
    const fileId = String(opts?.fileId || pointer.fileId || '').trim();
    return fileId ? { root: pointer.root, rel: pointer.rel, fileId } : { root: pointer.root, rel: pointer.rel };
  }
  const items = Array.isArray(opts?.items) ? opts.items : [];
  const item = items.find(
    (row) => row && row.kind === 'package' && row.assetId === pointer.assetId && row.root === pointer.root,
  );
  return {
    root: pointer.root,
    assetId: pointer.assetId,
    fileId: String(opts?.fileId || pointer.fileId || item?.displayFileId || '').trim() || undefined,
    packageRel: item?.rel,
  };
}

export function pointerFromSelection(
  ids: Iterable<string>,
  activeRoot: string,
): WorkshopCardPointer | null {
  const root = String(activeRoot || '').trim();
  for (const id of ids) {
    const parsed = parseWorkshopCardId(String(id || ''));
    if (!parsed) continue;
    if (root && parsed.root !== root) continue;
    return parsed;
  }
  return null;
}
