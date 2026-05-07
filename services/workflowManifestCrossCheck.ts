import type { WorkflowAsset } from '../types';
import type { CompanionManifestV1 } from './companionClient/storage';
import { attachInitialVgpToNewAsset } from './vgp/vgpStore';
import { isWorkflowTextAsset } from './workflowTextAsset';
import {
  imageSrcToDataUrlForCompanion,
  putWorkflowModelBlobToCompanion,
  putWorkflowOriginalImageToCompanion,
  putWorkflowResultImageToCompanion,
  sanitizeCompanionPathSegment,
  workflowModelCompanionStorageKey,
  workflowOriginalCompanionStorageKey,
  workflowResultCompanionStorageKey,
} from './workflowCompanionAssets';

export type CompanionManifestKeyGap =
  | { kind: 'original'; assetId: string; key: string }
  | { kind: 'result'; assetId: string; stepId: string; key: string }
  | { kind: 'model'; assetId: string; slotIndex: number; key: string };

/**
 * 打开项目后比对：画布上 `originalCompanionKey` 与各步 `resultsCompanionKeys` 是否出现在 manifest.entries。
 */
export function findCompanionKeysMissingFromManifest(
  assets: WorkflowAsset[],
  manifest: CompanionManifestV1 | null | undefined
): CompanionManifestKeyGap[] {
  if (!manifest || !Array.isArray(manifest.entries)) return [];
  const keys = new Set(
    manifest.entries.map((e) => String(e?.key || '').trim()).filter(Boolean)
  );
  const out: CompanionManifestKeyGap[] = [];
  for (const a of assets) {
    if (isWorkflowTextAsset(a)) continue;
    const ok = String(a.originalCompanionKey || '').trim();
    if (ok && !keys.has(ok)) {
      out.push({ kind: 'original', assetId: String(a.id || '').trim() || '?', key: ok });
    }
    const rck = a.resultsCompanionKeys;
    if (rck && typeof rck === 'object') {
      for (const stepId of Object.keys(rck)) {
        const rk = String(rck[stepId] || '').trim();
        if (!rk) continue;
        if (!keys.has(rk)) {
          out.push({
            kind: 'result',
            assetId: String(a.id || '').trim() || '?',
            stepId,
            key: rk,
          });
        }
      }
    }
    const mck = a.modelCompanionKeys;
    if (mck && Array.isArray(mck)) {
      for (let slot = 0; slot < mck.length; slot += 1) {
        const mk = String(mck[slot] || '').trim();
        if (!mk) continue;
        if (!keys.has(mk)) {
          out.push({
            kind: 'model',
            assetId: String(a.id || '').trim() || '?',
            slotIndex: slot,
            key: mk,
          });
        }
      }
    }
  }
  return out;
}

/**
 * @deprecated 使用 {@link findCompanionKeysMissingFromManifest} 并筛选 `kind === 'original'`
 */
export function findOriginalCompanionKeysMissingFromManifest(
  assets: WorkflowAsset[],
  manifest: CompanionManifestV1 | null | undefined
): Array<{ assetId: string; key: string }> {
  return findCompanionKeysMissingFromManifest(assets, manifest)
    .filter((g) => g.kind === 'original')
    .map((g) => ({ assetId: g.assetId, key: g.key }));
}

const DEFAULT_MAX_REPAIR = 48;

/**
 * 对 manifest 中缺失的键：若浏览器内存中仍有对应图像串（data/blob/http），则重新 PUT，触发伴侣侧 manifest upsert。
 * 无内存图、键与资产 id 推导不一致、或 PUT 失败则计入 skipped/failed。
 */
export async function attemptRepairCompanionManifestKeyGaps(
  baseUrl: string,
  projectId: string,
  assets: WorkflowAsset[],
  gaps: CompanionManifestKeyGap[],
  onLog?: (level: 'info' | 'warn', title: string, detail: string) => void,
  opts?: { maxAttempts?: number }
): Promise<{ repaired: number; skipped: number; failed: number }> {
  const max = Math.max(1, opts?.maxAttempts ?? DEFAULT_MAX_REPAIR);
  const pid = String(projectId || '').trim();
  const base = String(baseUrl || '').trim();
  if (gaps.length === 0) {
    return { repaired: 0, skipped: 0, failed: 0 };
  }
  if (!pid || !base) {
    return { repaired: 0, skipped: gaps.length, failed: 0 };
  }

  const assetById = new Map<string, WorkflowAsset>();
  for (const a of assets) {
    assetById.set(String(a.id || '').trim(), a);
  }

  let repaired = 0;
  let skipped = 0;
  let failed = 0;
  const slice = gaps.slice(0, max);

  for (const gap of slice) {
    const asset = assetById.get(gap.assetId);
    if (!asset || isWorkflowTextAsset(asset)) {
      skipped += 1;
      continue;
    }

    if (gap.kind === 'original') {
      const expectKey = workflowOriginalCompanionStorageKey(gap.assetId);
      if (expectKey !== gap.key) {
        onLog?.('warn', '伴侣原图键与资产 id 推导不一致，跳过修复', `asset=${gap.assetId} stored=${gap.key} expected=${expectKey}`);
        skipped += 1;
        continue;
      }
      const src = String(asset.original || '').trim();
      const dataUrl = await imageSrcToDataUrlForCompanion(src);
      if (!dataUrl) {
        skipped += 1;
        continue;
      }
      const put = await putWorkflowOriginalImageToCompanion(base, pid, gap.assetId, dataUrl);
      if (put.ok) {
        repaired += 1;
      } else if (put.ok === false) {
        failed += 1;
        onLog?.('warn', 'manifest 修复：原图重新 PUT 失败', `${gap.assetId}: ${put.error}`);
      }
      continue;
    }

    if (gap.kind === 'model') {
      const expectKey = workflowModelCompanionStorageKey(gap.assetId, gap.slotIndex);
      if (expectKey !== gap.key) {
        onLog?.('warn', '伴侣 3D 模型键与推导不一致，跳过修复', `asset=${gap.assetId} slot=${gap.slotIndex}`);
        skipped += 1;
        continue;
      }
      const src = String((asset.modelUrls || [])[gap.slotIndex] ?? '').trim();
      let blob: Blob | null = null;
      try {
        if (/^blob:|^https?:|^data:/i.test(src)) {
          const r = await fetch(src);
          blob = await r.blob();
        }
      } catch {
        blob = null;
      }
      if (!blob) {
        skipped += 1;
        continue;
      }
      const put = await putWorkflowModelBlobToCompanion(
        base,
        pid,
        gap.assetId,
        gap.slotIndex,
        blob,
        asset.modelSourceName
      );
      if (put.ok) {
        repaired += 1;
      } else if (put.ok === false) {
        failed += 1;
        onLog?.('warn', 'manifest 修复：3D 模型重新 PUT 失败', `${gap.assetId}[${gap.slotIndex}]: ${put.error}`);
      }
      continue;
    }

    const expectKey = workflowResultCompanionStorageKey(gap.assetId, gap.stepId);
    if (expectKey !== gap.key) {
      onLog?.('warn', '伴侣步骤结果键与推导不一致，跳过修复', `asset=${gap.assetId} step=${gap.stepId}`);
      skipped += 1;
      continue;
    }
    const src = String((asset.results || {})[gap.stepId] ?? '').trim();
    const dataUrl = await imageSrcToDataUrlForCompanion(src);
    if (!dataUrl) {
      skipped += 1;
      continue;
    }
    const put = await putWorkflowResultImageToCompanion(base, pid, gap.assetId, gap.stepId, dataUrl);
    if (put.ok) {
      repaired += 1;
    } else if (put.ok === false) {
      failed += 1;
      onLog?.('warn', 'manifest 修复：步骤结果重新 PUT 失败', `${gap.assetId}/${gap.stepId}: ${put.error}`);
    }
  }

  const notAttempted = Math.max(0, gaps.length - slice.length);
  skipped += notAttempted;
  if (notAttempted > 0) {
    onLog?.('info', 'manifest 自动修复达到单次上限', `已处理 ${slice.length} 项，余 ${notAttempted} 项未尝试`);
  }

  if (repaired > 0 || failed > 0) {
    onLog?.(
      'info',
      'manifest 键自动修复完成',
      `成功 ${repaired} / 跳过 ${skipped} / 失败 ${failed}（仅内存仍有图时才能重 PUT）`
    );
  }

  return { repaired, skipped, failed };
}

/** 画布上已引用到的伴侣对象键（原图 / 步骤结果 / 模型槽位） */
export function collectReferencedCompanionKeys(assets: WorkflowAsset[]): Set<string> {
  const keys = new Set<string>();
  for (const a of assets) {
    if (isWorkflowTextAsset(a)) continue;
    const ok = String(a.originalCompanionKey || '').trim();
    if (ok) keys.add(ok);
    const rck = a.resultsCompanionKeys;
    if (rck && typeof rck === 'object') {
      for (const stepId of Object.keys(rck)) {
        const rk = String(rck[stepId] || '').trim();
        if (rk) keys.add(rk);
      }
    }
    const mck = a.modelCompanionKeys;
    if (mck && Array.isArray(mck)) {
      for (const mk of mck) {
        const k = String(mk || '').trim();
        if (k) keys.add(k);
      }
    }
  }
  return keys;
}

function classifyManifestEntryForAutoImport(entry: {
  key: string;
  mime?: string;
  relPath?: string;
}): 'image' | 'model' | null {
  const key = String(entry.key || '').trim();
  if (!key) return null;
  const mime = String(entry.mime || '').trim().toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('model/')) return 'model';
  if (key.includes('wf-mdl-')) return 'model';
  if (key.includes('wf-res-') || key.includes('wf-orig-')) return 'image';
  if (mime === 'application/octet-stream' || !mime) {
    const rp = String(entry.relPath || '').toLowerCase();
    if (/\.(glb|gltf|fbx|obj|stl)(\?|#|$)/.test(rp)) return 'model';
    if (/\.(png|jpe?g|webp|gif|bmp|avif)(\?|#|$)/.test(rp)) return 'image';
  }
  return null;
}

const WF_ORIG_P = 'wf-orig-';
const WF_RES_P = 'wf-res-';
const WF_MDL_P = 'wf-mdl-';

function parseMdlCompanionKey(key: string): { assetSanitizedId: string; slot: number } | null {
  if (!key.startsWith(WF_MDL_P)) return null;
  const body = key.slice(WF_MDL_P.length);
  const lastDash = body.lastIndexOf('-');
  if (lastDash <= 0) return null;
  const slotStr = body.slice(lastDash + 1);
  const slot = Number(slotStr);
  if (!Number.isFinite(slot) || slot < 0 || String(slot) !== slotStr) return null;
  return { assetSanitizedId: body.slice(0, lastDash), slot };
}

/** manifest 中 wf-orig 后缀（完整）→ 其前 48 字符（与 wf-res 首段对齐） */
function buildOrigPrefix48ToFullMap(manifest: CompanionManifestV1): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of manifest.entries) {
    const k = String(e?.key || '').trim();
    if (!k.startsWith(WF_ORIG_P)) continue;
    const full = k.slice(WF_ORIG_P.length);
    m.set(full.slice(0, 48), full);
  }
  return m;
}

/** wf-res 体为「标准 UUID + '-' + 步骤键…」时，无 wf-orig 也能解析出资产前缀 */
const WF_RES_BODY_UUID_PREFIX =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-/i;

function collectResMatchPrefixes(
  manifest: CompanionManifestV1,
  assets: WorkflowAsset[],
  origP48ToFull: Map<string, string>
): string[] {
  const S = new Set<string>();
  for (const p of origP48ToFull.keys()) S.add(p);
  for (const e of manifest.entries) {
    const k = String(e?.key || '').trim();
    const mdl = parseMdlCompanionKey(k);
    if (mdl) S.add(mdl.assetSanitizedId.slice(0, 48));
    if (k.startsWith(WF_RES_P)) {
      const body = k.slice(WF_RES_P.length);
      const um = body.match(WF_RES_BODY_UUID_PREFIX);
      if (um?.[1]) S.add(um[1]);
    }
  }
  for (const a of assets) {
    if (isWorkflowTextAsset(a)) continue;
    const id = String(a.id || '').trim();
    if (id) S.add(sanitizeCompanionPathSegment(id).slice(0, 48));
  }
  return [...S].sort((a, b) => b.length - a.length);
}

function parseResCompanionKey(
  fullKey: string,
  sortedPrefixes: string[]
): { assetPrefix48: string; resultKey: string } | null {
  if (!fullKey.startsWith(WF_RES_P)) return null;
  const body = fullKey.slice(WF_RES_P.length);
  for (const p of sortedPrefixes) {
    if (!p) continue;
    if (body.startsWith(`${p}-`)) {
      return { assetPrefix48: p, resultKey: body.slice(p.length + 1) };
    }
  }
  return null;
}

function resolveCanonicalAssetId(
  assetPrefix48: string,
  fullMdlSanitizedId: string | undefined,
  origP48ToFull: Map<string, string>
): string {
  const fromOrig = origP48ToFull.get(assetPrefix48);
  if (fromOrig) return fromOrig;
  if (fullMdlSanitizedId && fullMdlSanitizedId.slice(0, 48) === assetPrefix48) {
    return fullMdlSanitizedId;
  }
  return assetPrefix48;
}

type WfUnlinkedGroup = {
  canonicalAssetId: string;
  origCompanionKey?: string;
  results: Record<string, string>;
  models: Record<number, string>;
  importedKeys: string[];
};

function ensureGroup(map: Map<string, WfUnlinkedGroup>, canonicalAssetId: string): WfUnlinkedGroup {
  let g = map.get(canonicalAssetId);
  if (!g) {
    g = { canonicalAssetId, importedKeys: [], results: {}, models: {} };
    map.set(canonicalAssetId, g);
  }
  return g;
}

function mergeWorkflowCompanionGroupIntoAsset(asset: WorkflowAsset, g: WfUnlinkedGroup): WorkflowAsset {
  let next: WorkflowAsset = { ...asset };
  if (g.origCompanionKey && !String(next.originalCompanionKey || '').trim()) {
    next.originalCompanionKey = g.origCompanionKey;
  }
  const rck = { ...(next.resultsCompanionKeys || {}) };
  for (const [step, k] of Object.entries(g.results)) {
    rck[step] = k;
  }
  next.resultsCompanionKeys = Object.keys(rck).length > 0 ? rck : undefined;
  const ro = new Set([...(next.resultOrder || [])]);
  for (const step of Object.keys(g.results)) ro.add(step);
  next.resultOrder = ro.size > 0 ? Array.from(ro).sort() : next.resultOrder;

  if (Object.keys(g.models).length > 0) {
    const slots = Object.keys(g.models).map((x) => Number(x));
    const maxSlot = Math.max(...slots, (next.modelCompanionKeys?.length ?? 0) - 1, 0);
    const mck = [...(next.modelCompanionKeys || [])];
    while (mck.length <= maxSlot) mck.push('');
    for (const [slotStr, k] of Object.entries(g.models)) {
      mck[Number(slotStr)] = k;
    }
    next.modelCompanionKeys = mck.some(Boolean) ? mck : undefined;
  }
  return attachInitialVgpToNewAsset(next);
}

function findExistingAssetIndexForCompanionGroup(assets: WorkflowAsset[], canonicalAssetId: string): number {
  const g48 = canonicalAssetId.slice(0, 48);
  return assets.findIndex((a) => {
    if (isWorkflowTextAsset(a)) return false;
    const sid = sanitizeCompanionPathSegment(String(a.id || '').trim());
    if (sid === canonicalAssetId) return true;
    if (sid.slice(0, 48) === g48) return true;
    const ok = String(a.originalCompanionKey || '').trim();
    if (ok === `${WF_ORIG_P}${canonicalAssetId}`) return true;
    if (ok.startsWith(WF_ORIG_P) && ok.slice(WF_ORIG_P.length) === canonicalAssetId) return true;
    return false;
  });
}

/**
 * 将 manifest 中已登记、但画布 JSON 未引用的对象自动补成工作流卡片（依赖伴侣后续 hydrate 出 blob 预览）。
 * 工作流伴侣键 `wf-orig-*` / `wf-res-*` / `wf-mdl-*` 按 **同一资产 id** 合并为一张卡片，避免扫盘时每文件一张卡、丢失步骤关系。
 */
export function mergeUnlinkedManifestEntriesIntoWorkflowAssets(
  assets: WorkflowAsset[],
  manifest: CompanionManifestV1 | null | undefined,
  newId: () => string
): { nextAssets: WorkflowAsset[]; importedKeys: string[] } {
  if (!manifest?.entries?.length) return { nextAssets: assets, importedKeys: [] };
  const referenced = collectReferencedCompanionKeys(assets);
  const importedKeys: string[] = [];
  const origP48ToFull = buildOrigPrefix48ToFullMap(manifest);
  const sortedPrefixes = collectResMatchPrefixes(manifest, assets, origP48ToFull);

  const wfGroups = new Map<string, WfUnlinkedGroup>();
  const legacyUnlinked: typeof manifest.entries = [];

  for (const e of manifest.entries) {
    const key = String(e?.key || '').trim();
    if (!key || referenced.has(key)) continue;
    const kind = classifyManifestEntryForAutoImport({ key, mime: e.mime, relPath: e.relPath });
    if (!kind) continue;

    if (key.startsWith(WF_ORIG_P)) {
      const full = key.slice(WF_ORIG_P.length);
      const g = ensureGroup(wfGroups, full);
      g.origCompanionKey = key;
      g.importedKeys.push(key);
      referenced.add(key);
      importedKeys.push(key);
      continue;
    }

    const mdl = parseMdlCompanionKey(key);
    if (mdl) {
      const canon = resolveCanonicalAssetId(
        mdl.assetSanitizedId.slice(0, 48),
        mdl.assetSanitizedId,
        origP48ToFull
      );
      const g = ensureGroup(wfGroups, canon);
      g.models[mdl.slot] = key;
      g.importedKeys.push(key);
      referenced.add(key);
      importedKeys.push(key);
      continue;
    }

    if (key.startsWith(WF_RES_P)) {
      const parsed = parseResCompanionKey(key, sortedPrefixes);
      if (parsed) {
        const canon = resolveCanonicalAssetId(parsed.assetPrefix48, undefined, origP48ToFull);
        const g = ensureGroup(wfGroups, canon);
        g.results[parsed.resultKey] = key;
        g.importedKeys.push(key);
        referenced.add(key);
        importedKeys.push(key);
        continue;
      }
    }

    legacyUnlinked.push(e);
  }

  let nextAssets = assets.map((a) => ({ ...a }));
  const newAssets: WorkflowAsset[] = [];

  for (const g of wfGroups.values()) {
    const idx = findExistingAssetIndexForCompanionGroup(nextAssets, g.canonicalAssetId);
    if (idx >= 0) {
      nextAssets[idx] = mergeWorkflowCompanionGroupIntoAsset(nextAssets[idx]!, g);
    } else {
      const maxSlot =
        Object.keys(g.models).length > 0 ? Math.max(...Object.keys(g.models).map((x) => Number(x))) : -1;
      const mck =
        maxSlot >= 0
          ? Array.from({ length: maxSlot + 1 }, (_, i) => g.models[i] || '')
          : undefined;
      const resultOrder = Object.keys(g.results).sort();
      const rck =
        Object.keys(g.results).length > 0 ? { ...g.results } : undefined;
      newAssets.push(
        attachInitialVgpToNewAsset({
          id: g.canonicalAssetId,
          original: '',
          originalCompanionKey: g.origCompanionKey,
          displayKey: 'original',
          results: {},
          resultOrder,
          resultsCompanionKeys: rck,
          modelCompanionKeys: mck,
          modelUrls: [],
          archived: false,
          hiddenInGrid: false,
          createdAt: Date.now(),
        })
      );
    }
  }

  for (const e of legacyUnlinked) {
    const key = String(e?.key || '').trim();
    if (!key || referenced.has(key)) continue;
    const kind = classifyManifestEntryForAutoImport({ key, mime: e.mime, relPath: e.relPath });
    if (!kind) continue;
    referenced.add(key);
    importedKeys.push(key);
    if (kind === 'image') {
      newAssets.push(
        attachInitialVgpToNewAsset({
          id: newId(),
          original: '',
          originalCompanionKey: key,
          displayKey: 'original',
          results: {},
          resultOrder: [],
          archived: false,
          hiddenInGrid: false,
          createdAt: Date.now(),
        })
      );
    } else {
      newAssets.push(
        attachInitialVgpToNewAsset({
          id: newId(),
          original: '',
          displayKey: 'original',
          results: {},
          resultOrder: [],
          modelCompanionKeys: [key],
          modelUrls: [],
          archived: false,
          hiddenInGrid: false,
          createdAt: Date.now(),
        })
      );
    }
  }

  if (importedKeys.length === 0) {
    return { nextAssets: assets, importedKeys: [] };
  }
  return { nextAssets: [...nextAssets, ...newAssets], importedKeys };
}
