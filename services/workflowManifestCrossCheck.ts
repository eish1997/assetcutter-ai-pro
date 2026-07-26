import type { WorkflowAsset } from '../types';
import {
  getCompanionAssetMeta,
  type CompanionManifestV1,
} from './companionClient/storage';
import { attachInitialVgpToNewAsset } from './vgp/vgpStore';
import { isWorkflowStoryboardTableAsset } from './storyboardTableAsset';
import { isWorkflowTextAsset } from './workflowTextAsset';
import {
  imageSrcToDataUrlForCompanion,
  legacyWorkflowCompanionAssetKeyCandidates,
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
  | { kind: 'model'; assetId: string; slotIndex: number; key: string; stepId?: string }
  | { kind: 'storyboard_frame'; assetId: string; rowId: string; key: string }
  | { kind: 'storyboard_history'; assetId: string; rowId: string; versionId: string; key: string };

function companionManifestHasKeyOrLegacyCandidate(keys: Set<string>, key: string): boolean {
  const k = String(key || '').trim();
  if (!k) return true;
  if (keys.has(k)) return true;
  return legacyWorkflowCompanionAssetKeyCandidates(k).some((candidate) => keys.has(candidate));
}

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
    if (ok && !companionManifestHasKeyOrLegacyCandidate(keys, ok)) {
      out.push({ kind: 'original', assetId: String(a.id || '').trim() || '?', key: ok });
    }
    const rck = a.resultsCompanionKeys;
    if (rck && typeof rck === 'object') {
      for (const stepId of Object.keys(rck)) {
        const rk = String(rck[stepId] || '').trim();
        if (!rk) continue;
        if (!companionManifestHasKeyOrLegacyCandidate(keys, rk)) {
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
        if (!companionManifestHasKeyOrLegacyCandidate(keys, mk)) {
          out.push({
            kind: 'model',
            assetId: String(a.id || '').trim() || '?',
            slotIndex: slot,
            key: mk,
          });
        }
      }
    }
    const smck = a.stepModelCompanionKeys;
    if (smck && typeof smck === 'object') {
      for (const stepId of Object.keys(smck)) {
        const keysForStep = Array.isArray(smck[stepId]) ? smck[stepId] : [];
        for (let slot = 0; slot < keysForStep.length; slot += 1) {
          const mk = String(keysForStep[slot] || '').trim();
          if (!mk || companionManifestHasKeyOrLegacyCandidate(keys, mk)) continue;
          out.push({
            kind: 'model',
            assetId: String(a.id || '').trim() || '?',
            slotIndex: slot,
            stepId,
            key: mk,
          });
        }
      }
    }
    if (isWorkflowStoryboardTableAsset(a) && a.storyboardTable?.rows?.length) {
      const assetId = String(a.id || '').trim() || '?';
      for (const row of a.storyboardTable.rows) {
        const rowId = String(row.id || '').trim();
        const frameKey = String(row.frameImageCompanionKey || '').trim();
        if (frameKey && !companionManifestHasKeyOrLegacyCandidate(keys, frameKey)) {
          out.push({ kind: 'storyboard_frame', assetId, rowId, key: frameKey });
        }
        for (const ver of row.frameImageHistory || []) {
          const histKey = String(ver.frameImageCompanionKey || '').trim();
          if (!histKey || companionManifestHasKeyOrLegacyCandidate(keys, histKey)) continue;
          out.push({
            kind: 'storyboard_history',
            assetId,
            rowId,
            versionId: String(ver.id || '').trim(),
            key: histKey,
          });
        }
      }
    }
  }
  return out;
}

export function removeMissingCompanionKeyReferences(
  assets: WorkflowAsset[],
  gaps: CompanionManifestKeyGap[]
): { assets: WorkflowAsset[]; removed: number } {
  if (!gaps.length) return { assets, removed: 0 };
  const gapsByAsset = new Map<string, CompanionManifestKeyGap[]>();
  for (const gap of gaps) {
    const list = gapsByAsset.get(gap.assetId) ?? [];
    list.push(gap);
    gapsByAsset.set(gap.assetId, list);
  }

  let removed = 0;
  const nextAssets = assets.map((asset) => {
    const assetGaps = gapsByAsset.get(String(asset.id || '').trim());
    if (!assetGaps?.length) return asset;
    let next = asset;

    for (const gap of assetGaps) {
      if (gap.kind === 'original') {
        if (String(next.originalCompanionKey || '').trim() === gap.key) {
          const original = String(next.original || '').trim();
          next = {
            ...next,
            originalCompanionKey: undefined,
            ...(original === gap.key ? { original: '' } : {}),
          };
          removed += 1;
        }
        continue;
      }

      if (gap.kind === 'result') {
        const rck = { ...(next.resultsCompanionKeys || {}) };
        if (String(rck[gap.stepId] || '').trim() === gap.key) {
          delete rck[gap.stepId];
          const resultValue = String((next.results || {})[gap.stepId] ?? '').trim();
          next = {
            ...next,
            resultsCompanionKeys: Object.keys(rck).length ? rck : undefined,
            ...(next.displayKey === gap.stepId && !resultValue ? { displayKey: 'original' } : {}),
          };
          removed += 1;
        }
        continue;
      }

      if (gap.kind === 'model') {
        const mck = [...(next.modelCompanionKeys || [])];
        let touched = false;
        if (String(mck[gap.slotIndex] || '').trim() === gap.key) {
          mck[gap.slotIndex] = '';
          touched = true;
        }
        const smck = { ...(next.stepModelCompanionKeys || {}) };
        const stepIds = gap.stepId ? [gap.stepId] : Object.keys(smck);
        for (const stepId of stepIds) {
          const arr = Array.isArray(smck[stepId]) ? [...smck[stepId]] : [];
          if (String(arr[gap.slotIndex] || '').trim() === gap.key) {
            arr[gap.slotIndex] = '';
            smck[stepId] = arr;
            touched = true;
          }
        }
        if (touched) {
          next = {
            ...next,
            modelCompanionKeys: mck.some(Boolean) ? mck : undefined,
            stepModelCompanionKeys: Object.keys(smck).some((stepId) => (smck[stepId] || []).some(Boolean))
              ? smck
              : undefined,
          };
          removed += 1;
        }
        continue;
      }

      if (isWorkflowStoryboardTableAsset(next) && next.storyboardTable?.rows?.length) {
        const rows = next.storyboardTable.rows.map((row) => {
          if (gap.kind === 'storyboard_frame' && row.id === gap.rowId && row.frameImageCompanionKey === gap.key) {
            removed += 1;
            return { ...row, frameImageCompanionKey: undefined };
          }
          if (gap.kind !== 'storyboard_history' || row.id !== gap.rowId) return row;
          let rowTouched = false;
          const frameImageHistory = (row.frameImageHistory || []).map((ver) => {
            if (ver.id !== gap.versionId || ver.frameImageCompanionKey !== gap.key) return ver;
            rowTouched = true;
            removed += 1;
            return { ...ver, frameImageCompanionKey: undefined };
          });
          return rowTouched ? { ...row, frameImageHistory } : row;
        });
        next = { ...next, storyboardTable: { ...next.storyboardTable, rows } };
      }
    }

    return next;
  });

  return removed > 0 ? { assets: nextAssets, removed } : { assets, removed: 0 };
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
/** Disk probe result: only `absent` may enter open-project key cleanup. */
export type CompanionDiskPresence = 'present' | 'absent' | 'unknown';

function isCompanionMetaNotFound(meta: { ok: false; error: string; status?: number; code?: string }): boolean {
  if (meta.status === 404) return true;
  const code = String(meta.code || '').trim();
  const err = String(meta.error || '').trim();
  return (
    code === 'STORAGE_NOT_FOUND' ||
    /not_found|STORAGE_NOT_FOUND/i.test(code) ||
    /not_found|STORAGE_NOT_FOUND/i.test(err)
  );
}

async function probeCompanionAssetDiskPresence(
  baseUrl: string,
  projectId: string,
  key: string
): Promise<CompanionDiskPresence> {
  const meta = await getCompanionAssetMeta(baseUrl, projectId, key);
  if (meta.ok) return meta.data.onDisk ? 'present' : 'absent';
  // Network / companion-down must not be treated as "file missing".
  if (isCompanionMetaNotFound(meta)) return 'absent';
  return 'unknown';
}

/** Probe companion volume: key (or legacy candidate) still has bytes on disk. */
export async function companionAssetKeyPresentOnDisk(
  baseUrl: string,
  projectId: string,
  key: string
): Promise<CompanionDiskPresence> {
  const base = String(baseUrl || '').trim();
  const pid = String(projectId || '').trim();
  const k = String(key || '').trim();
  if (!base || !pid || !k) return 'unknown';
  const keys = [k, ...legacyWorkflowCompanionAssetKeyCandidates(k)];
  let sawUnknown = false;
  for (const candidate of keys) {
    const presence = await probeCompanionAssetDiskPresence(base, pid, candidate);
    if (presence === 'present') return 'present';
    if (presence === 'unknown') sawUnknown = true;
  }
  return sawUnknown ? 'unknown' : 'absent';
}

/**
 * Open-project gap resolution: repair → reconcile → re-scan.
 * Only keys still missing from the refreshed manifest AND absent on disk may be cleaned.
 * Never pass the pre-repair gap list into {@link removeMissingCompanionKeyReferences}.
 */
export async function resolveCompanionManifestGapsForProjectOpen(params: {
  baseUrl: string;
  projectId: string;
  assets: WorkflowAsset[];
  manifest: CompanionManifestV1;
  reconcile: () => Promise<{ ok: true; data: { added: number; keys: string[] } } | { ok: false; error: string }>;
  refetchManifest: () => Promise<{ ok: true; data: CompanionManifestV1 } | { ok: false; error: string }>;
  onLog?: (level: 'info' | 'warn', title: string, detail: string) => void;
}): Promise<{
  manifest: CompanionManifestV1;
  initialGaps: CompanionManifestKeyGap[];
  gapsToClean: CompanionManifestKeyGap[];
}> {
  const base = String(params.baseUrl || '').trim();
  const pid = String(params.projectId || '').trim();
  let manifest = params.manifest;
  const assets = params.assets;
  const initialGaps = findCompanionKeysMissingFromManifest(assets, manifest);
  if (initialGaps.length === 0) {
    return { manifest, initialGaps, gapsToClean: [] };
  }
  // No companion probe context → never clean (avoid wiping locators without disk evidence).
  if (!base || !pid) {
    return { manifest, initialGaps, gapsToClean: [] };
  }

  await attemptRepairCompanionManifestKeyGaps(base, pid, assets, initialGaps, params.onLog);

  const recon = await params.reconcile();
  if (recon.ok && recon.data.added > 0) {
    const kp = recon.data.keys.slice(0, 5).join(', ') + (recon.data.keys.length > 5 ? '…' : '');
    params.onLog?.('info', '本地伴侣已从磁盘补全 manifest', `${recon.data.added} 项 ${kp}`);
  } else if (recon.ok === false) {
    params.onLog?.('warn', '本地伴侣 manifest 磁盘补全请求失败', String(recon.error));
  }

  const refreshed = await params.refetchManifest();
  if (refreshed.ok) {
    manifest = refreshed.data;
  } else {
    params.onLog?.('warn', '本地伴侣 manifest 刷新失败（清理将更保守）', String(refreshed.error));
  }

  const stillMissing = findCompanionKeysMissingFromManifest(assets, manifest);
  const gapsToClean: CompanionManifestKeyGap[] = [];
  for (const gap of stillMissing) {
    const presence = await companionAssetKeyPresentOnDisk(base, pid, gap.key);
    if (presence === 'present') {
      params.onLog?.(
        'warn',
        '伴侣对象在磁盘上但仍未进 manifest，保留项目引用',
        `${gap.kind}:${gap.assetId}:${gap.key}`
      );
      continue;
    }
    if (presence === 'unknown') {
      params.onLog?.(
        'warn',
        '伴侣对象磁盘探测失败，保留项目引用（不清理）',
        `${gap.kind}:${gap.assetId}:${gap.key}`
      );
      continue;
    }
    gapsToClean.push(gap);
  }

  return { manifest, initialGaps, gapsToClean };
}

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
      if (!companionKeyMatchesWorkflowSlot(gap)) {
        onLog?.('warn', '伴侣原图键与资产 id 推导不一致，跳过修复', `asset=${gap.assetId} stored=${gap.key}`);
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
      if (!companionKeyMatchesWorkflowSlot(gap)) {
        onLog?.('warn', '伴侣 3D 模型键与推导不一致，跳过修复', `asset=${gap.assetId} slot=${gap.slotIndex}`);
        skipped += 1;
        continue;
      }
      // File may already be on disk while manifest lagged; treat as repaired so open-project cleanup won't drop keys.
      const presence = await companionAssetKeyPresentOnDisk(base, pid, gap.key);
      if (presence === 'present') {
        repaired += 1;
        continue;
      }
      let src = '';
      if (gap.stepId) {
        src = String((asset.stepModelUrls?.[gap.stepId] || [])[gap.slotIndex] ?? '').trim();
      }
      if (!src) {
        src = String((asset.modelUrls || [])[gap.slotIndex] ?? '').trim();
      }
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

    if (!companionKeyMatchesWorkflowSlot(gap)) {
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
    const smck = a.stepModelCompanionKeys;
    if (smck && typeof smck === 'object') {
      for (const stepId of Object.keys(smck)) {
        const list = smck[stepId];
        if (!Array.isArray(list)) continue;
        for (const mk of list) {
          const k = String(mk || '').trim();
          if (k) keys.add(k);
        }
      }
    }
    if (isWorkflowStoryboardTableAsset(a) && a.storyboardTable?.rows?.length) {
      for (const row of a.storyboardTable.rows) {
        const fk = String(row.frameImageCompanionKey || '').trim();
        if (fk) keys.add(fk);
        for (const ver of row.frameImageHistory || []) {
          const hk = String(ver.frameImageCompanionKey || '').trim();
          if (hk) keys.add(hk);
        }
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
  if (mime.startsWith('model/') || mime.includes('fbx') || mime.includes('obj') || mime.includes('gltf')) return 'model';
  if (key.includes('wf-mdl-')) return 'model';
  if (key.includes('wf-res-') || key.includes('wf-orig-')) return 'image';
  if (/\/model-(full|thumb)-\d+/i.test(key)) return 'model';
  if (/\/(image|video)-(full|thumb)-\d+/i.test(key)) return 'image';
  if (/\/original-model-[^/]+\.(glb|gltf|fbx|obj|stl)(\?|#|$)/i.test(key)) return 'model';
  if (/\/original-(image|video|text|binary)-[^/]+\./i.test(key)) return 'image';
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

function parseAssetDirectoryCompanionKey(
  key: string
):
  | { kind: 'original'; assetId: string }
  | { kind: 'result'; assetId: string; resultKey: string }
  | { kind: 'model'; assetId: string; slot: number }
  | null {
  const parts = String(key || '').trim().split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const assetId = parts[0];
  const stem = parts[1].replace(/\.[^.]+$/, '');
  // `{mediaKind}-{role}-{slot}-{id8}`（thumb 为 sidecar，不单独建卡）
  const named = /^(image|model|video)-(full|thumb)-(\d+)(?:-[a-z0-9]{4,12})?$/i.exec(stem);
  if (named) {
    const mediaKind = named[1]!.toLowerCase();
    const role = named[2]!.toLowerCase();
    const slot = Math.max(0, Number.parseInt(named[3]!, 10) || 0);
    if (role === 'thumb') return null;
    if (mediaKind === 'model') return { kind: 'model', assetId, slot };
    // 出生原图/原视频与 slot0 主文件同名；>0 的结果槽用 synthetic step 键（文件名不含 actionId）
    if (slot === 0) return { kind: 'original', assetId };
    return { kind: 'result', assetId, resultKey: `slot_${slot}` };
  }
  if (stem === 'original') return { kind: 'original', assetId };
  if (stem.startsWith('original-model-')) return { kind: 'model', assetId, slot: 0 };
  if (stem.startsWith('original-')) return { kind: 'original', assetId };
  if (stem.startsWith('result-')) {
    const resultKey = stem.slice('result-'.length).trim();
    if (resultKey) return { kind: 'result', assetId, resultKey };
  }
  if (/^model-\d+$/i.test(stem)) {
    const slotStr = stem.slice('model-'.length);
    const slot = Number(slotStr);
    if (Number.isFinite(slot) && slot >= 0 && String(slot) === slotStr) {
      return { kind: 'model', assetId, slot };
    }
  }
  return null;
}

function companionKeyMatchesWorkflowSlot(gap: CompanionManifestKeyGap): boolean {
  const key = String(gap.key || '').trim();
  const dirKey = parseAssetDirectoryCompanionKey(key);
  if (dirKey) {
    if (sanitizeCompanionPathSegment(gap.assetId) !== sanitizeCompanionPathSegment(dirKey.assetId)) return false;
    if (gap.kind === 'original') return dirKey.kind === 'original';
    if (gap.kind === 'model') return dirKey.kind === 'model' && dirKey.slot === gap.slotIndex;
    if (gap.kind === 'result') {
      // legacy `result-{step}` 含步骤名；新 `image-full-{slot}` 不含 actionId（步骤在 JSON）
      if (dirKey.kind === 'result' && dirKey.resultKey === gap.stepId) return true;
      return dirKey.kind === 'result' || dirKey.kind === 'original';
    }
  }
  if (gap.kind === 'original') return key === `${WF_ORIG_P}${sanitizeCompanionPathSegment(gap.assetId)}`;
  if (gap.kind === 'model') {
    return key === `${WF_MDL_P}${sanitizeCompanionPathSegment(gap.assetId)}-${gap.slotIndex}`;
  }
  if (gap.kind === 'result') {
    return key.startsWith(`${WF_RES_P}${sanitizeCompanionPathSegment(gap.assetId).slice(0, 48)}-`);
  }
  return false;
}

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
    const dirKey = parseAssetDirectoryCompanionKey(k);
    if (dirKey) S.add(sanitizeCompanionPathSegment(dirKey.assetId).slice(0, 48));
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
    if (ok.startsWith(`${canonicalAssetId}/`)) return true;
    if (ok === `${WF_ORIG_P}${canonicalAssetId}`) return true;
    if (ok.startsWith(WF_ORIG_P) && ok.slice(WF_ORIG_P.length) === canonicalAssetId) return true;
    return false;
  });
}

export type MergeUnlinkedManifestOptions = {
  /**
   * manifest 里**非** `wf-orig` / `wf-res` / `wf-mdl` 规范的「遗留」条目：默认不导入（每文件一张新卡，易把组/血缘打乱）。
   * 仅当显式开启（如 `VITE_WORKSPACE_IMPORT_LEGACY_COMPANION_ORPHANS=true`）时才插入画布。
   */
  importLegacyOrphans?: boolean;
};

/**
 * 将 manifest 中已登记、但画布 JSON 未引用的对象自动补成工作流卡片（依赖伴侣后续 hydrate 出 blob 预览）。
 * 工作流伴侣键 `wf-orig-*` / `wf-res-*` / `wf-mdl-*` 按 **同一资产 id** 合并为一张卡片，避免扫盘时每文件一张卡、丢失步骤关系。
 */
export function mergeUnlinkedManifestEntriesIntoWorkflowAssets(
  assets: WorkflowAsset[],
  manifest: CompanionManifestV1 | null | undefined,
  newId: () => string,
  options?: MergeUnlinkedManifestOptions
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

    const dirKey = parseAssetDirectoryCompanionKey(key);
    if (dirKey) {
      const g = ensureGroup(wfGroups, sanitizeCompanionPathSegment(dirKey.assetId));
      if (dirKey.kind === 'original') g.origCompanionKey = key;
      else if (dirKey.kind === 'result') g.results[dirKey.resultKey] = key;
      else g.models[dirKey.slot] = key;
      g.importedKeys.push(key);
      referenced.add(key);
      importedKeys.push(key);
      continue;
    }

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

  if (options?.importLegacyOrphans === true) {
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
  }

  if (importedKeys.length === 0) {
    return { nextAssets: assets, importedKeys: [] };
  }
  return { nextAssets: [...nextAssets, ...newAssets], importedKeys };
}
