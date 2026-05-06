import type { WorkflowAsset } from '../types';
import type { CompanionManifestV1 } from './companionClient/storage';
import { attachInitialVgpToNewAsset } from './vgp/vgpStore';
import { isWorkflowTextAsset } from './workflowTextAsset';
import {
  imageSrcToDataUrlForCompanion,
  putWorkflowModelBlobToCompanion,
  putWorkflowOriginalImageToCompanion,
  putWorkflowResultImageToCompanion,
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

/**
 * 将 manifest 中已登记、但画布 JSON 未引用的对象自动补成工作流卡片（依赖伴侣后续 hydrate 出 blob 预览）。
 */
export function mergeUnlinkedManifestEntriesIntoWorkflowAssets(
  assets: WorkflowAsset[],
  manifest: CompanionManifestV1 | null | undefined,
  newId: () => string
): { nextAssets: WorkflowAsset[]; importedKeys: string[] } {
  if (!manifest?.entries?.length) return { nextAssets: assets, importedKeys: [] };
  const referenced = collectReferencedCompanionKeys(assets);
  const importedKeys: string[] = [];
  const additions: WorkflowAsset[] = [];
  for (const e of manifest.entries) {
    const key = String(e?.key || '').trim();
    if (!key || referenced.has(key)) continue;
    const kind = classifyManifestEntryForAutoImport({ key, mime: e.mime, relPath: e.relPath });
    if (!kind) continue;
    referenced.add(key);
    importedKeys.push(key);
    if (kind === 'image') {
      additions.push(
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
      additions.push(
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
  if (additions.length === 0) return { nextAssets: assets, importedKeys: [] };
  return { nextAssets: [...assets, ...additions], importedKeys };
}
