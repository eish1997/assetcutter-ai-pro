import type { WorkflowAsset, WorkflowPendingTask } from '../types';
import { readLocalString, removeLocalKey, safeLocalStorage, writeLocalJson, writeLocalString, writeLocalStringOrThrow } from './clientPersist';
import { idbDeleteBundle, idbLoadBundleJson, idbSaveBundleJson } from './workspaceBundleIdb';
import { migrateLegacyAssets } from './assetGroupMigration';
import { stripWorkflowBundleForIdbPersist } from './workflowCompanionAssets';

export type WorkspaceProject = {
  id: string;
  name: string;
  createdAt: number;
  /** 绑定账号：仅用于索引与协作语义，不影响本地目录真相源 */
  boundUserId?: string;
  boundAt?: number;
  /** 最近一次手动上传工作流资产到云端的时间戳 */
  lastManualUploadAt?: number;
  /** 最近一次手动上传时的项目资产计数 */
  lastManualUploadAssetCount?: number;
  /** 最近一次手动上传时估算字节数（仅用于 UI 提示） */
  lastManualUploadBytesApprox?: number;
  /** 最近一次手动上传模式 */
  lastManualUploadMode?: 'full' | 'incremental';
  /** 最近一次手动上传的总尝试项 */
  lastManualUploadAttemptedCount?: number;
  /** 最近一次手动上传成功项 */
  lastManualUploadSucceededCount?: number;
  /** 最近一次手动上传失败项（用于一键重试） */
  lastManualUploadFailedAssetIds?: string[];
  /** 最近一次手动上传错误摘要 */
  lastManualUploadError?: string;
};

/** null = 未登录访客（站点级 legacy 键）；string = 已登录用户，与账号隔离 */
export type WorkspacePersistUserId = string | null;

const newId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 12));

function projectsStorageKey(persistUserId: WorkspacePersistUserId): string {
  return persistUserId ? `ac_workspace_projects_v1__u_${persistUserId}` : 'ac_workspace_projects_v1';
}

function lastOpenStorageKey(persistUserId: WorkspacePersistUserId): string {
  return persistUserId ? `ac_workspace_last_open_v1__u_${persistUserId}` : 'ac_workspace_last_open_v1';
}

export function workflowBundleStorageKey(projectId: string, persistUserId: WorkspacePersistUserId): string {
  return persistUserId
    ? `ac_workflow_bundle_v1__u_${persistUserId}_${projectId}`
    : `ac_workflow_bundle_v1_${projectId}`;
}

/** 浏览器端持久化 workflow bundle 的 schema 版本；历史包缺此字段视为 0 */
export const WORKFLOW_BUNDLE_SCHEMA_CURRENT = 1;

export type WorkflowProjectBundle = {
  assets: WorkflowAsset[];
  pending: WorkflowPendingTask[];
  /** 项目仅保留能力引用（账号能力定义不落项目） */
  capabilityRefs?: Array<{ kind: 'preset' | 'set'; id: string; snapshot?: unknown }>;
  /** 缺省或旧数据在 `parseBundleJson` / 保存时对齐到 `WORKFLOW_BUNDLE_SCHEMA_CURRENT` */
  workflowBundleSchemaVersion?: number;
};

function migrateWorkflowBundleSchema(bundle: WorkflowProjectBundle): WorkflowProjectBundle {
  let v = bundle.workflowBundleSchemaVersion;
  if (v === undefined || v === null || typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
    v = 0;
  }
  let b: WorkflowProjectBundle = bundle;
  if (v < 1) {
    b = { ...b, workflowBundleSchemaVersion: 1 };
    v = 1;
  }
  if (v < WORKFLOW_BUNDLE_SCHEMA_CURRENT) {
    b = { ...b, workflowBundleSchemaVersion: WORKFLOW_BUNDLE_SCHEMA_CURRENT };
  }
  return b;
}

const bundleMemoryCache = new Map<string, WorkflowProjectBundle>();
const migrationNoticesQueue: string[] = [];
const migrationNoticesSeen = new Set<string>();
/** 同一 bundle 连续保存时只保留待写入 JSON，避免排队多次完整 IDB 写入 */
const pendingIdbPayloadByKey = new Map<string, string>();
const pendingIdbWrites = new Map<string, Promise<void>>();
/** removeWorkflowBundle 后跳过已在队列中的写入，避免删项又被写回 IDB */
const cancelledIdbBundleKeys = new Set<string>();

function cloneBundle(b: WorkflowProjectBundle): WorkflowProjectBundle {
  return JSON.parse(JSON.stringify(b)) as WorkflowProjectBundle;
}

function parseBundleJson(raw: string): WorkflowProjectBundle {
  const data = JSON.parse(raw) as Partial<
    WorkflowProjectBundle & {
      capabilityPresets?: Array<{ id?: string } & Record<string, unknown>>;
      capabilitySets?: Array<{ id?: string } & Record<string, unknown>>;
    }
  >;
  const rawSchema =
    typeof data.workflowBundleSchemaVersion === 'number' && Number.isFinite(data.workflowBundleSchemaVersion)
      ? data.workflowBundleSchemaVersion
      : undefined;
  const refsFromProject = Array.isArray(data.capabilityRefs)
    ? data.capabilityRefs
        .map((r) => {
          const kind: 'preset' | 'set' | null =
            r?.kind === 'set' ? 'set' : r?.kind === 'preset' ? 'preset' : null;
          const id = String(r?.id || '').trim();
          if (!kind || !id) return null;
          return { kind, id, ...(r?.snapshot != null ? { snapshot: r.snapshot } : {}) };
        })
        .filter((v): v is NonNullable<typeof v> => v != null)
    : [];
  const hasLegacyCapabilityPresets = Array.isArray(data.capabilityPresets) && data.capabilityPresets.length > 0;
  const hasLegacyCapabilitySets = Array.isArray(data.capabilitySets) && data.capabilitySets.length > 0;
  const refsFromLegacyPresets = Array.isArray(data.capabilityPresets)
    ? data.capabilityPresets
        .map((p) => {
          const id = String(p?.id || '').trim();
          if (!id) return null;
          return { kind: 'preset' as const, id, snapshot: p };
        })
        .filter((v): v is NonNullable<typeof v> => v != null)
    : [];
  const refsFromLegacySets = Array.isArray(data.capabilitySets)
    ? data.capabilitySets
        .map((s) => {
          const id = String(s?.id || '').trim();
          if (!id) return null;
          return { kind: 'set' as const, id, snapshot: s };
        })
        .filter((v): v is NonNullable<typeof v> => v != null)
    : [];
  const refMap = new Map<string, { kind: 'preset' | 'set'; id: string; snapshot?: unknown }>();
  for (const ref of [...refsFromLegacyPresets, ...refsFromLegacySets, ...refsFromProject]) {
    refMap.set(`${ref.kind}:${ref.id}`, ref);
  }
  const bundle: WorkflowProjectBundle = {
    assets: Array.isArray(data.assets) ? data.assets : [],
    pending: Array.isArray(data.pending) ? data.pending : [],
    capabilityRefs: Array.from(refMap.values()),
    ...(rawSchema !== undefined ? { workflowBundleSchemaVersion: rawSchema } : {}),
  };
  if (hasLegacyCapabilityPresets || hasLegacyCapabilitySets) {
    const notice = '检测到历史项目内嵌能力定义，已自动迁移为 capabilityRefs（能力归属账号级）';
    if (!migrationNoticesSeen.has(notice)) {
      migrationNoticesSeen.add(notice);
      migrationNoticesQueue.push(notice);
    }
  }
  // 迁移旧数据到新结构
  bundle.assets = migrateLegacyAssets(bundle.assets);
  return migrateWorkflowBundleSchema(bundle);
}

export function consumeWorkspaceMigrationNotices(): string[] {
  if (migrationNoticesQueue.length === 0) return [];
  return migrationNoticesQueue.splice(0, migrationNoticesQueue.length);
}

function schedulePersistToIdb(bundleKey: string, json: string): void {
  if (typeof indexedDB === 'undefined') {
    const st = safeLocalStorage();
    if (st) {
      try {
        st.setItem(bundleKey, json);
      } catch (e) {
        const name = typeof DOMException !== 'undefined' && e instanceof DOMException ? e.name : '';
        if (name === 'QuotaExceededError' || (e instanceof Error && /quota/i.test(e.message))) {
          console.error(
            '[workspace] localStorage 空间不足（无 IndexedDB）。请减少大图或启用云端同步。'
          );
        } else {
          console.error('[workspace] 保存失败', e);
        }
      }
    }
    return;
  }

  pendingIdbPayloadByKey.set(bundleKey, json);
  cancelledIdbBundleKeys.delete(bundleKey);
  if (pendingIdbWrites.has(bundleKey)) return;

  const drain = async (): Promise<void> => {
    try {
      while (pendingIdbPayloadByKey.has(bundleKey)) {
        const payload = pendingIdbPayloadByKey.get(bundleKey)!;
        pendingIdbPayloadByKey.delete(bundleKey);
        if (cancelledIdbBundleKeys.has(bundleKey)) {
          cancelledIdbBundleKeys.delete(bundleKey);
          continue;
        }
        try {
          await idbSaveBundleJson(bundleKey, payload);
          removeLocalKey(bundleKey);
        } catch (e) {
          console.warn('[workspace] IndexedDB 保存失败，回退 localStorage', e);
          try {
            writeLocalStringOrThrow(bundleKey, payload);
          } catch (e2) {
            const name = typeof DOMException !== 'undefined' && e2 instanceof DOMException ? e2.name : '';
            if (name === 'QuotaExceededError' || (e2 instanceof Error && /quota/i.test(e2.message))) {
              console.error('[workspace] localStorage 空间不足，画布未能完整保存。');
            } else {
              console.error('[workspace] 回退保存失败', e2);
            }
          }
        }
        if (cancelledIdbBundleKeys.has(bundleKey)) {
          cancelledIdbBundleKeys.delete(bundleKey);
          removeLocalKey(bundleKey);
          void idbDeleteBundle(bundleKey);
        }
      }
    } finally {
      pendingIdbWrites.delete(bundleKey);
    }
  };

  const p = drain();
  pendingIdbWrites.set(bundleKey, p);
}

export function loadWorkspaceProjects(persistUserId: WorkspacePersistUserId = null): WorkspaceProject[] {
  const pk = projectsStorageKey(persistUserId);
  try {
    const raw = readLocalString(pk);
    let list: WorkspaceProject[] = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) list = [];
    if (list.length === 0) {
      const p: WorkspaceProject = { id: newId(), name: '默认项目', createdAt: Date.now() };
      list = [p];
      writeLocalJson(pk, list);
    }
    return list;
  } catch {
    const p: WorkspaceProject = { id: newId(), name: '默认项目', createdAt: Date.now() };
    writeLocalJson(pk, [p]);
    return [p];
  }
}

export function saveWorkspaceProjects(projects: WorkspaceProject[], persistUserId: WorkspacePersistUserId = null): void {
  writeLocalJson(projectsStorageKey(persistUserId), projects);
}

export function createWorkspaceProject(name: string): WorkspaceProject {
  const trimmed = name.trim();
  return {
    id: newId(),
    name: trimmed || '未命名项目',
    createdAt: Date.now(),
  };
}

export function getLastOpenedWorkspaceProjectId(persistUserId: WorkspacePersistUserId = null): string | null {
  try {
    const id = readLocalString(lastOpenStorageKey(persistUserId));
    if (!id) return null;
    const projects = loadWorkspaceProjects(persistUserId);
    return projects.some((p) => p.id === id) ? id : null;
  } catch {
    return null;
  }
}

/** 首屏恢复：上次打开的项目及其工作流数据（需在 loadWorkspaceProjects 之后调用） */
export function readInitialWorkflowProjectSession(persistUserId: WorkspacePersistUserId = null): {
  activeProjectId: string | null;
  assets: WorkflowAsset[];
  pending: WorkflowPendingTask[];
} {
  const activeProjectId = getLastOpenedWorkspaceProjectId(persistUserId);
  if (!activeProjectId) return { activeProjectId: null, assets: [], pending: [] };
  const b = loadWorkflowBundle(activeProjectId, persistUserId);
  return { activeProjectId, assets: b.assets, pending: b.pending };
}

export function setLastOpenedWorkspaceProjectId(id: string | null, persistUserId: WorkspacePersistUserId = null): void {
  const lk = lastOpenStorageKey(persistUserId);
  if (id == null) removeLocalKey(lk);
  else writeLocalString(lk, id);
}

export function loadWorkflowBundle(projectId: string, persistUserId: WorkspacePersistUserId = null): WorkflowProjectBundle {
  const key = workflowBundleStorageKey(projectId, persistUserId);
  const cached = bundleMemoryCache.get(key);
  if (cached) return cloneBundle(cached);
  try {
    const raw = readLocalString(key);
    if (!raw) return migrateWorkflowBundleSchema({ assets: [], pending: [] });
    const bundle = parseBundleJson(raw);
    bundleMemoryCache.set(key, cloneBundle(bundle));
    return bundle;
  } catch {
    return migrateWorkflowBundleSchema({ assets: [], pending: [] });
  }
}

export function saveWorkflowBundle(
  projectId: string,
  bundle: WorkflowProjectBundle,
  persistUserId: WorkspacePersistUserId = null
): void {
  const key = workflowBundleStorageKey(projectId, persistUserId);
  const snapshot = cloneBundle(bundle);
  snapshot.workflowBundleSchemaVersion = WORKFLOW_BUNDLE_SCHEMA_CURRENT;
  bundleMemoryCache.set(key, snapshot);
  const payload = JSON.stringify(stripWorkflowBundleForIdbPersist(snapshot));
  schedulePersistToIdb(key, payload);
}

/** 等待正在进行的 IndexedDB 写入完成（供 pagehide / 关页前尽力落盘） */
export async function flushWorkspaceBundleIdbWrites(): Promise<void> {
  const pending = [...pendingIdbWrites.values()];
  if (pending.length === 0) return;
  await Promise.allSettled(pending);
}

/**
 * 本地伴侣将项目目录从 `oldProjectId` 重命名为 `newProjectId` 后，同步迁移浏览器内 workflow bundle 存储键。
 * 调用前应已完成伴侣侧重命名且 `newProjectId` 已写入项目列表。
 */
export async function migrateWorkflowBundleProjectId(
  oldProjectId: string,
  newProjectId: string,
  persistUserId: WorkspacePersistUserId
): Promise<void> {
  const oldId = String(oldProjectId || '').trim();
  const newId = String(newProjectId || '').trim();
  if (!oldId || !newId || oldId === newId) return;
  await flushWorkspaceBundleIdbWrites();
  const bundle = loadWorkflowBundle(oldId, persistUserId);
  saveWorkflowBundle(newId, bundle, persistUserId);
  removeWorkflowBundle(oldId, persistUserId);
  await flushWorkspaceBundleIdbWrites();
}

/** 从 IndexedDB 拉取各项目 bundle 进内存，并迁移仅存在于 localStorage 的旧数据 */
export async function ensureWorkspaceBundlesHydratedFromIdb(persistUserId: WorkspacePersistUserId): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const projects = loadWorkspaceProjects(persistUserId);
  for (const p of projects) {
    const key = workflowBundleStorageKey(p.id, persistUserId);
    try {
      const fromIdb = await idbLoadBundleJson(key);
      if (fromIdb) {
        const bundle = parseBundleJson(fromIdb);
        bundleMemoryCache.set(key, cloneBundle(bundle));
        continue;
      }
      const raw = readLocalString(key);
      if (raw) {
        const bundle = parseBundleJson(raw);
        bundleMemoryCache.set(key, cloneBundle(bundle));
        await idbSaveBundleJson(key, raw).catch(() => {});
        removeLocalKey(key);
      }
    } catch (e) {
      console.warn('[workspace] hydrate bundle', key, e);
    }
  }
}

/** 与 saveWorkflowBundle 相同，但配额等错误不抛，供 pagehide 等场景尽力持久化 */
export function trySaveWorkflowBundle(
  projectId: string,
  bundle: WorkflowProjectBundle,
  persistUserId: WorkspacePersistUserId = null
): boolean {
  try {
    saveWorkflowBundle(projectId, bundle, persistUserId);
    return true;
  } catch {
    return false;
  }
}

export function removeWorkflowBundle(projectId: string, persistUserId: WorkspacePersistUserId = null): void {
  const key = workflowBundleStorageKey(projectId, persistUserId);
  bundleMemoryCache.delete(key);
  pendingIdbPayloadByKey.delete(key);
  cancelledIdbBundleKeys.add(key);
  removeLocalKey(key);
  void idbDeleteBundle(key);
}
