import {
  fetchWorkflowOriginalFromCompanionAsObjectUrl,
  imageSrcToDataUrlForCompanion,
  putWorkflowResultImageToCompanion,
} from './workflowCompanionAssets';
import { resolveStoryboardFrameDisplaySrc } from './storyboardFrameImageUrl';

export type StoryboardNamedAssetImageFields = {
  image?: string;
  imageCompanionKey?: string;
  imageObjectKey?: string;
};

export type StoryboardNamedAssetKind = 'role' | 'scene';

export function storyboardNamedAssetCompanionResultKey(
  kind: StoryboardNamedAssetKind,
  namedAssetId: string
): string {
  const id = String(namedAssetId || '').trim();
  return kind === 'role' ? `storyboard-role-asset-${id}` : `storyboard-scene-asset-${id}`;
}

export function resolveStoryboardNamedAssetDisplaySrc(
  asset: StoryboardNamedAssetImageFields | null | undefined
): string {
  if (!asset) return '';
  return resolveStoryboardFrameDisplaySrc(asset.image, asset.imageObjectKey) || '';
}

export function storyboardNamedAssetHasImageRef(
  asset: StoryboardNamedAssetImageFields | null | undefined
): boolean {
  if (!asset) return false;
  if (String(asset.image || '').trim()) return true;
  if (String(asset.imageObjectKey || '').trim()) return true;
  if (String(asset.imageCompanionKey || '').trim()) return true;
  return false;
}

/** 生图/拼图替换：解析 inline、R2 或伴侣键为 data URL */
export async function resolveStoryboardNamedAssetImageDataUrl(
  asset: StoryboardNamedAssetImageFields | null | undefined,
  opts?: { companionBaseUrl?: string; companionProjectId?: string }
): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> {
  if (!storyboardNamedAssetHasImageRef(asset)) {
    return { ok: false, error: '尚未上传参考图' };
  }

  const display = resolveStoryboardNamedAssetDisplaySrc(asset);
  if (display) {
    const dataUrl = await imageSrcToDataUrlForCompanion(display);
    if (dataUrl) return { ok: true, dataUrl };
  }

  const companionKey = String(asset?.imageCompanionKey || '').trim();
  if (companionKey) {
    const base = String(opts?.companionBaseUrl || '').trim();
    const pid = String(opts?.companionProjectId || '').trim();
    if (!base || !pid) {
      return { ok: false, error: '参考图在本地伴侣中，请连接本机伴侣后重试' };
    }
    const got = await fetchWorkflowOriginalFromCompanionAsObjectUrl(base, pid, companionKey);
    if (got.ok === false) {
      return { ok: false, error: '参考图无法从伴侣加载，请重新上传' };
    }
    const dataUrl = await imageSrcToDataUrlForCompanion(got.objectUrl);
    URL.revokeObjectURL(got.objectUrl);
    if (!dataUrl) {
      return { ok: false, error: '参考图无法加载，请重新上传' };
    }
    return { ok: true, dataUrl };
  }

  return { ok: false, error: '参考图无法加载，请重新上传' };
}

export type PersistStoryboardNamedAssetImageOpts = {
  dataUrl: string;
  tableAssetId: string;
  namedAssetId: string;
  kind: StoryboardNamedAssetKind;
  companionBaseUrl: string;
  companionProjectId: string;
};

/** 落本地伴侣；成功后可保留 blob URL 供 UI，并写入 companionKey 以减轻 IDB / 同步体积 */
export async function persistStoryboardNamedAssetImage(
  opts: PersistStoryboardNamedAssetImageOpts
): Promise<StoryboardNamedAssetImageFields> {
  const dataUrl = String(opts.dataUrl || '').trim();
  if (!dataUrl) {
    return { image: undefined, imageCompanionKey: undefined, imageObjectKey: undefined };
  }

  const base = String(opts.companionBaseUrl || '').trim();
  const pid = String(opts.companionProjectId || '').trim();
  if (!base || !pid) {
    return { image: dataUrl, imageCompanionKey: undefined, imageObjectKey: undefined };
  }

  const put = await putWorkflowResultImageToCompanion(
    base,
    pid,
    opts.tableAssetId,
    storyboardNamedAssetCompanionResultKey(opts.kind, opts.namedAssetId),
    dataUrl
  );
  if (!put.ok) {
    return { image: dataUrl, imageCompanionKey: undefined, imageObjectKey: undefined };
  }

  const got = await fetchWorkflowOriginalFromCompanionAsObjectUrl(base, pid, put.key);
  if (got.ok) {
    return {
      image: got.objectUrl,
      imageCompanionKey: put.key,
      imageObjectKey: undefined,
    };
  }
  return {
    image: dataUrl,
    imageCompanionKey: put.key,
    imageObjectKey: undefined,
  };
}

export function clearStoryboardNamedAssetImageFields(): StoryboardNamedAssetImageFields {
  return { image: undefined, imageCompanionKey: undefined, imageObjectKey: undefined };
}

export function pickStoryboardNamedAssetImageFields(
  raw: StoryboardNamedAssetImageFields | null | undefined
): StoryboardNamedAssetImageFields {
  const image = String(raw?.image || '').trim() || undefined;
  const imageCompanionKey = String(raw?.imageCompanionKey || '').trim() || undefined;
  const imageObjectKey = String(raw?.imageObjectKey || '').trim() || undefined;
  if (!image && !imageCompanionKey && !imageObjectKey) return {};
  return { ...(image ? { image } : {}), ...(imageCompanionKey ? { imageCompanionKey } : {}), ...(imageObjectKey ? { imageObjectKey } : {}) };
}

export type StoryboardNamedAssetRecord = StoryboardNamedAssetImageFields & {
  id: string;
  name: string;
};

/** 云同步 / 多设备合并：按 id 并集，名称与图片引用取「有内容的一侧」 */
export function mergeStoryboardNamedAssets<T extends StoryboardNamedAssetRecord>(
  baseRaw: T[] | undefined,
  otherRaw: T[] | undefined,
  normalize: (raw: unknown) => T[]
): T[] | undefined {
  const map = new Map<string, T>();
  for (const item of normalize(baseRaw)) {
    map.set(item.id, item);
  }
  for (const item of normalize(otherRaw)) {
    const existing = map.get(item.id);
    if (!existing) {
      map.set(item.id, item);
      continue;
    }
    const existingName = String(existing.name || '').trim();
    const otherName = String(item.name || '').trim();
    const merged = {
      ...existing,
      ...item,
      name: existingName || otherName,
      image: String(existing.image || '').trim() || String(item.image || '').trim() || undefined,
      imageCompanionKey:
        String(existing.imageCompanionKey || '').trim() ||
        String(item.imageCompanionKey || '').trim() ||
        undefined,
      imageObjectKey:
        String(existing.imageObjectKey || '').trim() ||
        String(item.imageObjectKey || '').trim() ||
        undefined,
    } as T;
    map.set(item.id, merged);
  }
  const out = [...map.values()];
  return out.length ? out : undefined;
}

export type StoryboardNamedAssetCompanionHydrateTask = {
  tableAssetId: string;
  namedAssetId: string;
  kind: StoryboardNamedAssetKind;
  companionKey: string;
  prevImg: string;
};

export function listStoryboardNamedAssetCompanionHydrateTasks(
  tableAssetId: string,
  kind: StoryboardNamedAssetKind,
  assets: StoryboardNamedAssetRecord[] | undefined
): StoryboardNamedAssetCompanionHydrateTask[] {
  const out: StoryboardNamedAssetCompanionHydrateTask[] = [];
  for (const asset of assets ?? []) {
    const companionKey = String(asset.imageCompanionKey || '').trim();
    if (!companionKey) continue;
    out.push({
      tableAssetId,
      namedAssetId: asset.id,
      kind,
      companionKey,
      prevImg: String(asset.image || '').trim(),
    });
  }
  return out;
}

export function applyStoryboardNamedAssetCompanionHydrate(
  assets: StoryboardNamedAssetRecord[] | undefined,
  namedAssetId: string,
  objectUrl: string
): StoryboardNamedAssetRecord[] | undefined {
  if (!assets?.length) return assets;
  return assets.map((asset) =>
    asset.id === namedAssetId ? { ...asset, image: objectUrl } : asset
  );
}
