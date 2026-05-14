import type { ImageOverlayAnnotationDoc } from '../types';
import { readLocalJson, readSessionJson, scopedStorageKey, writeLocalJson, writeSessionJson } from './clientPersist';
import { getWorkflowMirrorPreferenceScope } from './workflowMirrorPreferenceScope';
import { idbLoadBundleJson, idbSaveBundleJson } from './workspaceBundleIdb';

/** 与 `readWorkflowOverlaySnapshotRing` 同源 */
export const WORKFLOW_OVERLAY_SNAPSHOT_SESSION_KEY = 'ac_workflow_overlay_snapshot_ring_v1';
/**
 * Overlay 环 **localStorage** 镜像基键（**尽力写入**：整包序列化超过 {@link MAX_LOCAL_OVERLAY_RING_SERIALIZED_BYTES} 则跳过，避免配额爆）。
 * 实际键为 **`scopedStorageKey(WORKFLOW_OVERLAY_LOCAL_BASE_KEY, preferenceScope)`**。
 */
export const WORKFLOW_OVERLAY_LOCAL_BASE_KEY = 'ac_workflow_overlay_snapshot_ring_v1_local';
/**
 * Overlay 环 **IndexedDB** 镜像键基名（与 bundle 库 **`workspaceBundleIdb`** 共用 DB，键空间与 `ac_workflow_bundle_v1_*` 不重叠）。
 * 全量写入 `entries` JSON（分块），**不受** {@link MAX_LOCAL_OVERLAY_RING_SERIALIZED_BYTES} 限制。
 */
export const WORKFLOW_OVERLAY_IDB_BUNDLE_BASE = 'ac_workflow_overlay_ring_idb_v1';

const MAX_ENTRIES = 50;
/** 单条 doc JSON 上限（保守低于 §9.1 建议 256KB） */
export const MAX_OVERLAY_SNAPSHOT_JSON_BYTES = 220_000;
/** 大图打开且 overlay 草稿变化时，写入 session 环的节流间隔（与 `docs/工作流步骤时间线审计与Overlay快照.md` §9.3 一致） */
export const WORKFLOW_OVERLAY_PERIODIC_SNAPSHOT_MS = 4000;
/** 整环 JSON 写入 local 的上限（字节）；超出则仅保留 session，避免 `QuotaExceededError` */
export const MAX_LOCAL_OVERLAY_RING_SERIALIZED_BYTES = 900_000;

export type WorkflowOverlaySnapshotBucket = 'flat' | 'pano';

/** `close`：关大图等显式时点；`periodic`：编辑过程 debounce，同资产+键+桶仅保留一条 active periodic */
export type WorkflowOverlaySnapshotReason = 'close' | 'periodic';

export type WorkflowOverlaySnapshotEntry = {
  id: string;
  createdAt: number;
  assetId: string;
  baseDisplayKey: string;
  bucket: WorkflowOverlaySnapshotBucket;
  /** 缺省按 `close` 读（旧 session 数据） */
  reason?: WorkflowOverlaySnapshotReason;
  status: 'active' | 'superseded';
  doc: ImageOverlayAnnotationDoc;
  docBytes: number;
};

type OverlayRingFile = { entries: WorkflowOverlaySnapshotEntry[] };

function overlayLocalStorageKey(): string {
  return scopedStorageKey(WORKFLOW_OVERLAY_LOCAL_BASE_KEY, getWorkflowMirrorPreferenceScope());
}

function overlayRingIdbBundleKey(): string {
  return scopedStorageKey(WORKFLOW_OVERLAY_IDB_BUNDLE_BASE, getWorkflowMirrorPreferenceScope());
}

function persistOverlayRingToIdb(entries: WorkflowOverlaySnapshotEntry[]): void {
  const key = overlayRingIdbBundleKey();
  void idbSaveBundleJson(key, JSON.stringify({ entries } as OverlayRingFile)).catch(() => {});
}

function readOverlaySessionRaw(): OverlayRingFile {
  return readSessionJson<OverlayRingFile>(WORKFLOW_OVERLAY_SNAPSHOT_SESSION_KEY, { entries: [] });
}

function readOverlayLocalRaw(): OverlayRingFile {
  return readLocalJson<OverlayRingFile>(overlayLocalStorageKey(), { entries: [] });
}

function mergeOverlayEntriesById(
  a: WorkflowOverlaySnapshotEntry[],
  b: WorkflowOverlaySnapshotEntry[]
): WorkflowOverlaySnapshotEntry[] {
  const m = new Map<string, WorkflowOverlaySnapshotEntry>();
  for (const e of a) {
    if (e && typeof e.id === 'string') m.set(e.id, e);
  }
  for (const e of b) {
    if (!e || typeof e.id !== 'string') continue;
    const o = m.get(e.id);
    if (!o || e.createdAt >= o.createdAt) m.set(e.id, e);
  }
  return Array.from(m.values())
    .sort((x, y) => x.createdAt - y.createdAt)
    .slice(-MAX_ENTRIES);
}

function readMergedOverlayEntries(): WorkflowOverlaySnapshotEntry[] {
  return mergeOverlayEntriesById(readOverlaySessionRaw().entries, readOverlayLocalRaw().entries);
}

function tryMirrorOverlayRingToLocal(entries: WorkflowOverlaySnapshotEntry[]): void {
  try {
    const file: OverlayRingFile = { entries };
    const encoded = JSON.stringify(file);
    if (encoded.length <= MAX_LOCAL_OVERLAY_RING_SERIALIZED_BYTES) {
      writeLocalJson(overlayLocalStorageKey(), file);
    }
  } catch {
    /* quota / stringify */
  }
}

function newId(): string {
  return `os_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function snapshotTripleKey(e: WorkflowOverlaySnapshotEntry): string {
  return `${e.assetId}\0${e.baseDisplayKey}\0${e.bucket}`;
}

function tripleKey(assetId: string, baseDisplayKey: string, bucket: WorkflowOverlaySnapshotBucket): string {
  return `${assetId}\0${baseDisplayKey}\0${bucket}`;
}

function entryReason(e: WorkflowOverlaySnapshotEntry): WorkflowOverlaySnapshotReason {
  return e.reason ?? 'close';
}

/**
 * P1 骨架：关大图前抓取当前桶 overlay 的**时点副本**写入 session 环，供后续「恢复 / 排障 UI」接层。
 * **`reason: 'periodic'`**：编辑过程 debounce，同 `(assetId, baseDisplayKey, bucket)` 下旧的 **active periodic** 先标为 `superseded`；**`close`** 写入前会 supersede 同三元组的 active **periodic**，避免与关窗时点双源并列。
 * **localStorage**：与审计环一致按 **`preferenceScope`** 镜像（尽力、受 {@link MAX_LOCAL_OVERLAY_RING_SERIALIZED_BYTES} 限制）；**IndexedDB**：**`workspaceBundleIdb`** 全量镜像（**`WORKFLOW_OVERLAY_IDB_BUNDLE_BASE`**）；**`readWorkflowOverlaySnapshotRing`** 合并 session + local（按 **`id`**）；新标签见 **`hydrateWorkflowOverlayRingSessionFromIdbOrLocalIfEmpty`**。
 * 超大 doc 静默丢弃（不占配额）。
 */
export function appendWorkflowOverlayCloseSnapshot(params: {
  assetId: string;
  baseDisplayKey: string;
  bucket: WorkflowOverlaySnapshotBucket;
  doc: ImageOverlayAnnotationDoc;
  reason?: WorkflowOverlaySnapshotReason;
}): WorkflowOverlaySnapshotEntry | null {
  const reason = params.reason ?? 'close';
  let json: string;
  try {
    json = JSON.stringify(params.doc);
  } catch {
    return null;
  }
  if (json.length > MAX_OVERLAY_SNAPSHOT_JSON_BYTES) {
    return null;
  }
  const entry: WorkflowOverlaySnapshotEntry = {
    id: newId(),
    createdAt: Date.now(),
    assetId: params.assetId,
    baseDisplayKey: params.baseDisplayKey,
    bucket: params.bucket,
    reason,
    status: 'active',
    doc: params.doc,
    docBytes: json.length,
  };
  const base = readMergedOverlayEntries();
  const want = tripleKey(params.assetId, params.baseDisplayKey, params.bucket);
  let coalesced = base;
  if (reason === 'periodic') {
    coalesced = coalesced.map((e) => {
      if (e.status !== 'active') return e;
      if (snapshotTripleKey(e) !== want) return e;
      if (entryReason(e) !== 'periodic') return e;
      return { ...e, status: 'superseded' as const };
    });
  } else {
    coalesced = coalesced.map((e) => {
      if (e.status !== 'active') return e;
      if (snapshotTripleKey(e) !== want) return e;
      if (entryReason(e) !== 'periodic') return e;
      return { ...e, status: 'superseded' as const };
    });
  }
  const entries = [...coalesced, entry].slice(-MAX_ENTRIES);
  writeSessionJson(WORKFLOW_OVERLAY_SNAPSHOT_SESSION_KEY, { entries });
  tryMirrorOverlayRingToLocal(entries);
  persistOverlayRingToIdb(entries);
  return entry;
}

/**
 * 新标签页 **session 环为空**时：优先从 **IndexedDB** 全量镜像恢复，其次从 **localStorage** 尽力镜像写入 session。
 * 供 **`WorkflowSection`** 挂载时调用，避免仅依赖被 900KB 截断的 local。
 */
export async function hydrateWorkflowOverlayRingSessionFromIdbOrLocalIfEmpty(): Promise<boolean> {
  if (readOverlaySessionRaw().entries.length > 0) return false;
  try {
    const raw = await idbLoadBundleJson(overlayRingIdbBundleKey());
    if (raw) {
      const file = JSON.parse(raw) as OverlayRingFile;
      if (file.entries?.length) {
        const entries = file.entries.slice(-MAX_ENTRIES);
        writeSessionJson(WORKFLOW_OVERLAY_SNAPSHOT_SESSION_KEY, { entries });
        tryMirrorOverlayRingToLocal(entries);
        return true;
      }
    }
  } catch {
    /* ignore */
  }
  const local = readOverlayLocalRaw();
  if (local.entries.length > 0) {
    writeSessionJson(WORKFLOW_OVERLAY_SNAPSHOT_SESSION_KEY, { entries: local.entries.slice(-MAX_ENTRIES) });
    return true;
  }
  return false;
}

export function readWorkflowOverlaySnapshotRing(): WorkflowOverlaySnapshotEntry[] {
  return readMergedOverlayEntries();
}

/**
 * 标注/裁切等 **已落盘到资产** 或 **写回产生新 resultKey** 后，将会话环中对应快照标为 `superseded`（§5.3 / §9.1）。
 * `baseDisplayKey` 省略时：该资产下全部 active 条目均 superseded（例如改尺寸写回后 `displayKey` 已变）。
 */
export function supersedeWorkflowOverlaySnapshotsForAsset(
  assetId: string,
  baseDisplayKey?: string
): void {
  const merged = readMergedOverlayEntries();
  const entries = merged.map((e) => {
    if (e.assetId !== assetId) return e;
    if (baseDisplayKey != null && e.baseDisplayKey !== baseDisplayKey) return e;
    if (e.status === 'superseded') return e;
    return { ...e, status: 'superseded' as const };
  });
  writeSessionJson(WORKFLOW_OVERLAY_SNAPSHOT_SESSION_KEY, { entries });
  tryMirrorOverlayRingToLocal(entries);
  persistOverlayRingToIdb(entries);
}
