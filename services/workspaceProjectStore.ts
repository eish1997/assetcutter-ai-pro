import type { WorkflowAsset, WorkflowPendingTask } from '../types';
import { readLocalString, removeLocalKey, safeLocalStorage, writeLocalJson, writeLocalString, writeLocalStringOrThrow } from './clientPersist';
import { idbDeleteBundle, idbLoadBundleJson, idbSaveBundleJson } from './workspaceBundleIdb';
import { migrateLegacyAssets } from './assetGroupMigration';
import { sanitizeWorkflowProjectBundle } from './workflowBundleSanitize';
import { stripWorkflowBundleForIdbPersist, prepareWorkflowBundleAfterLoad } from './workflowCompanionAssets';
import { isWorkflowStoryboardTableAsset } from './storyboardTableAsset';

export type WorkspaceProject = {
  id: string;
  name: string;
  createdAt: number;
  /** Agent CLI（云端 Soul API）创建的项目，工作台列表合并展示 */
  source?: 'agent-cli';
  /** @deprecated 历史字段，不再使用项目绑定 */
  boundUserId?: string;
  /** @deprecated 历史字段，不再使用项目绑定 */
  boundAt?: number;
  /** @deprecated 历史字段，手动上传已移除 */
  lastManualUploadAt?: number;
  /** @deprecated 历史字段，手动上传已移除 */
  lastManualUploadAssetCount?: number;
  /** @deprecated 历史字段，手动上传已移除 */
  lastManualUploadBytesApprox?: number;
  /** @deprecated 历史字段，手动上传已移除 */
  lastManualUploadMode?: 'full' | 'incremental';
  /** @deprecated 历史字段，手动上传已移除 */
  lastManualUploadAttemptedCount?: number;
  /** @deprecated 历史字段，手动上传已移除 */
  lastManualUploadSucceededCount?: number;
  /** @deprecated 历史字段，手动上传已移除 */
  lastManualUploadFailedAssetIds?: string[];
  /** @deprecated 历史字段，手动上传已移除 */
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
/** IDB 落盘后 localStorage 常为空；从原始 JSON 提取的分镜表快照，供保存/加载补回 */
const storyboardPersistGuardByKey = new Map<string, WorkflowAsset[]>();
const migrationNoticesQueue: string[] = [];
const migrationNoticesSeen = new Set<string>();
/** 最近一次 loadWorkflowBundle 是否降级（解析/规范化失败），供 App 避免空包覆盖落盘 */
let lastWorkflowBundleLoadDegraded = false;

export function consumeWorkflowBundleLoadDegraded(): boolean {
  const degraded = lastWorkflowBundleLoadDegraded;
  lastWorkflowBundleLoadDegraded = false;
  return degraded;
}
/** 同一 bundle 连续保存时只保留待写入 JSON，避免排队多次完整 IDB 写入 */
const pendingIdbPayloadByKey = new Map<string, { json: string; opts?: SaveWorkflowBundleOptions }>();
const pendingIdbWrites = new Map<string, Promise<void>>();
/** removeWorkflowBundle 后跳过已在队列中的写入，避免删项又被写回 IDB */
const cancelledIdbBundleKeys = new Set<string>();

function cloneBundle(b: WorkflowProjectBundle): WorkflowProjectBundle {
  return JSON.parse(JSON.stringify(b)) as WorkflowProjectBundle;
}

export type SaveWorkflowBundleOptions = {
  /** 本会话用户已见过非空画布，允许将本地 bundle 覆盖为空（删光资产） */
  allowEmptyOverwrite?: boolean;
  /** 用户在本会话显式删除的分镜表资产 id，保存时允许从 bundle 中移除 */
  explicitlyRemovedStoryboardIds?: ReadonlySet<string>;
};

/** 从持久化 JSON 提取分镜表资产（不跑 sanitize，避免规范化失败丢卡） */
export function extractStoryboardAssetsFromRawJson(raw: string): WorkflowAsset[] {
  try {
    const data = JSON.parse(raw) as Partial<WorkflowProjectBundle>;
    if (!Array.isArray(data.assets)) return [];
    return data.assets.filter((a) => isWorkflowStoryboardTableAsset(a as WorkflowAsset)) as WorkflowAsset[];
  } catch {
    return [];
  }
}

function rememberStoryboardPersistGuardFromRaw(key: string, raw: string): void {
  const extracted = extractStoryboardAssetsFromRawJson(raw);
  if (!extracted.length) return;
  const byId = new Map<string, WorkflowAsset>();
  for (const asset of storyboardPersistGuardByKey.get(key) ?? []) {
    const id = String(asset.id || '').trim();
    if (id) byId.set(id, asset);
  }
  for (const asset of extracted) {
    const id = String(asset.id || '').trim();
    if (!id) continue;
    byId.set(id, JSON.parse(JSON.stringify(asset)) as WorkflowAsset);
  }
  storyboardPersistGuardByKey.set(key, [...byId.values()]);
}

function syncStoryboardPersistGuardFromAssets(
  key: string,
  assets: WorkflowAsset[],
  explicitlyRemoved?: ReadonlySet<string>
): void {
  const byId = new Map<string, WorkflowAsset>();
  for (const asset of storyboardPersistGuardByKey.get(key) ?? []) {
    const id = String(asset.id || '').trim();
    if (!id || explicitlyRemoved?.has(id)) continue;
    byId.set(id, asset);
  }
  for (const asset of assets) {
    if (!isWorkflowStoryboardTableAsset(asset)) continue;
    const id = String(asset.id || '').trim();
    if (!id || explicitlyRemoved?.has(id)) continue;
    byId.set(id, JSON.parse(JSON.stringify(asset)) as WorkflowAsset);
  }
  if (byId.size) storyboardPersistGuardByKey.set(key, [...byId.values()]);
  else storyboardPersistGuardByKey.delete(key);
}

function resolveStoryboardAssetsForPersistGuard(
  key: string,
  cached: WorkflowProjectBundle | undefined
): WorkflowAsset[] {
  const byId = new Map<string, WorkflowAsset>();
  const add = (assets: WorkflowAsset[]) => {
    for (const asset of assets) {
      if (!isWorkflowStoryboardTableAsset(asset)) continue;
      const id = String(asset.id || '').trim();
      if (!id) continue;
      byId.set(id, asset);
    }
  };
  add(storyboardPersistGuardByKey.get(key) ?? []);
  add(cached?.assets ?? []);
  const raw = readLocalString(key);
  if (raw) add(extractStoryboardAssetsFromRawJson(raw));
  return [...byId.values()];
}

export function listStoryboardTableAssetIds(assets: WorkflowAsset[]): string[] {
  const out: string[] = [];
  for (const a of assets) {
    if (!isWorkflowStoryboardTableAsset(a)) continue;
    const id = String(a.id || '').trim();
    if (id) out.push(id);
  }
  return out;
}

/** 保存前：若 incoming 意外缺少已有分镜表资产，从 existing 补回（除非用户本会话已显式删除） */
export function mergePreservingStoryboardTableAssets(
  incoming: WorkflowProjectBundle,
  existingAssets: WorkflowAsset[],
  opts?: Pick<SaveWorkflowBundleOptions, 'explicitlyRemovedStoryboardIds'>
): { bundle: WorkflowProjectBundle; restoredStoryboardAssets: WorkflowAsset[] } {
  if (!existingAssets.length) return { bundle: incoming, restoredStoryboardAssets: [] };
  const incomingIds = new Set(
    incoming.assets.map((a) => String(a.id || '').trim()).filter(Boolean)
  );
  const removed = opts?.explicitlyRemovedStoryboardIds;
  const restore = existingAssets.filter((a) => {
    if (!isWorkflowStoryboardTableAsset(a)) return false;
    const id = String(a.id || '').trim();
    if (!id || incomingIds.has(id)) return false;
    if (removed?.has(id)) return false;
    return true;
  });
  if (!restore.length) return { bundle: incoming, restoredStoryboardAssets: [] };
  console.warn(
    '[workspace] restored storyboard_table assets that would have been lost',
    restore.map((a) => a.id)
  );
  const restoredStoryboardAssets = restore.map(
    (a) => cloneBundle({ assets: [a], pending: [] }).assets[0]!
  );
  return {
    bundle: { ...incoming, assets: [...incoming.assets, ...restoredStoryboardAssets] },
    restoredStoryboardAssets,
  };
}

export type SaveWorkflowBundleResult = {
  saved: boolean;
  restoredStoryboardAssets: WorkflowAsset[];
};

/** 统计持久化 JSON 中的资产条数；解析失败返回 0 */
export function countWorkflowBundleAssetsInJson(raw: string | null | undefined): number {
  if (!raw) return 0;
  try {
    const data = JSON.parse(raw) as Partial<WorkflowProjectBundle>;
    return Array.isArray(data.assets) ? data.assets.length : 0;
  } catch {
    return 0;
  }
}

/** 解析失败时的最小恢复：保留 assets/pending，不跑 sanitize */
export function recoverWorkflowBundleFromRawJson(raw: string): WorkflowProjectBundle {
  const data = JSON.parse(raw) as Partial<WorkflowProjectBundle>;
  return migrateWorkflowBundleSchema({
    assets: Array.isArray(data.assets) ? data.assets : [],
    pending: Array.isArray(data.pending) ? data.pending : [],
    ...(Array.isArray(data.capabilityRefs) ? { capabilityRefs: data.capabilityRefs } : {}),
    ...(typeof data.workflowBundleSchemaVersion === 'number' &&
    Number.isFinite(data.workflowBundleSchemaVersion)
      ? { workflowBundleSchemaVersion: data.workflowBundleSchemaVersion }
      : {}),
  });
}

export function shouldBlockEmptyWorkflowBundlePersist(
  incoming: WorkflowProjectBundle,
  opts: { existingAssetCount: number; allowEmptyOverwrite?: boolean }
): boolean {
  if ((incoming.assets?.length ?? 0) > 0) return false;
  if (opts.allowEmptyOverwrite) return false;
  return opts.existingAssetCount > 0;
}

function loadBundleIntoMemoryCache(key: string, raw: string): WorkflowProjectBundle {
  rememberStoryboardPersistGuardFromRaw(key, raw);
  let bundle: WorkflowProjectBundle;
  try {
    bundle = prepareWorkflowBundleAfterLoad(parseBundleJson(raw));
  } catch (e) {
    console.warn('[workspace] bundle load failed, raw recover', key, e);
    lastWorkflowBundleLoadDegraded = true;
    bundle = recoverWorkflowBundleFromRawJson(raw);
  }
  const { bundle: merged } = mergePreservingStoryboardTableAssets(
    bundle,
    storyboardPersistGuardByKey.get(key) ?? []
  );
  bundleMemoryCache.set(key, cloneBundle(merged));
  return merged;
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
  try {
    const hygiene = sanitizeWorkflowProjectBundle(bundle.assets, bundle.pending);
    bundle.assets = hygiene.assets;
    bundle.pending = hygiene.pending;
    const st = hygiene.stats;
    if (st.repairedGroupRefSlots > 0 || st.demotedEmptyGroups > 0 || st.prunedPendingTasks > 0) {
      const parts: string[] = [];
      if (st.repairedGroupRefSlots > 0) parts.push(`修正组内引用 ${st.repairedGroupRefSlots} 处`);
      if (st.demotedEmptyGroups > 0) parts.push(`空组降级为单卡 ${st.demotedEmptyGroups} 个`);
      if (st.prunedPendingTasks > 0) parts.push(`移除失效队列 ${st.prunedPendingTasks} 条`);
      const notice = `工作区已自动修复数据：${parts.join('；')}`;
      if (!migrationNoticesSeen.has(notice)) {
        migrationNoticesSeen.add(notice);
        migrationNoticesQueue.push(notice);
      }
    }
  } catch (e) {
    console.warn('[workspace] bundle sanitize failed, keeping migrated raw assets', e);
    lastWorkflowBundleLoadDegraded = true;
    const notice = '工作区数据规范化失败，已保留原始资产列表（请尽快导出备份）';
    if (!migrationNoticesSeen.has(notice)) {
      migrationNoticesSeen.add(notice);
      migrationNoticesQueue.push(notice);
    }
  }
  return migrateWorkflowBundleSchema(bundle);
}

/** 供测试与外部诊断：完整 parse 流程（含 sanitize） */
export function parseWorkflowBundleJson(raw: string): WorkflowProjectBundle {
  return parseBundleJson(raw);
}

export function consumeWorkspaceMigrationNotices(): string[] {
  if (migrationNoticesQueue.length === 0) return [];
  return migrationNoticesQueue.splice(0, migrationNoticesQueue.length);
}

function schedulePersistToIdb(
  bundleKey: string,
  json: string,
  opts?: SaveWorkflowBundleOptions
): void {
  if (typeof indexedDB === 'undefined') {
    const st = safeLocalStorage();
    if (st) {
      try {
        if (
          shouldBlockEmptyWorkflowBundlePersist(
            JSON.parse(json) as WorkflowProjectBundle,
            {
              existingAssetCount: countWorkflowBundleAssetsInJson(readLocalString(bundleKey)),
              allowEmptyOverwrite: opts?.allowEmptyOverwrite,
            }
          )
        ) {
          console.warn('[workspace] blocked empty localStorage overwrite', bundleKey);
          return;
        }
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

  pendingIdbPayloadByKey.set(bundleKey, { json, opts });
  cancelledIdbBundleKeys.delete(bundleKey);
  if (pendingIdbWrites.has(bundleKey)) return;

  const drain = async (): Promise<void> => {
    try {
      while (pendingIdbPayloadByKey.has(bundleKey)) {
        const pending = pendingIdbPayloadByKey.get(bundleKey)!;
        pendingIdbPayloadByKey.delete(bundleKey);
        const payload = pending.json;
        const persistOpts = pending.opts;
        if (cancelledIdbBundleKeys.has(bundleKey)) {
          cancelledIdbBundleKeys.delete(bundleKey);
          continue;
        }
        let incoming: WorkflowProjectBundle;
        try {
          incoming = JSON.parse(payload) as WorkflowProjectBundle;
        } catch {
          incoming = { assets: [], pending: [] };
        }
        const existingRaw = (await idbLoadBundleJson(bundleKey)) ?? readLocalString(bundleKey);
        if (
          shouldBlockEmptyWorkflowBundlePersist(incoming, {
            existingAssetCount: countWorkflowBundleAssetsInJson(existingRaw),
            allowEmptyOverwrite: persistOpts?.allowEmptyOverwrite,
          })
        ) {
          console.warn('[workspace] blocked empty IndexedDB overwrite', bundleKey);
          if (existingRaw) {
            loadBundleIntoMemoryCache(bundleKey, existingRaw);
          }
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
  lastWorkflowBundleLoadDegraded = false;
  const cached = bundleMemoryCache.get(key);
  if (cached) return cloneBundle(cached);
  const raw = readLocalString(key);
  if (!raw) {
    if (typeof indexedDB !== 'undefined') {
      lastWorkflowBundleLoadDegraded = true;
    }
    return migrateWorkflowBundleSchema({ assets: [], pending: [] });
  }
  return cloneBundle(loadBundleIntoMemoryCache(key, raw));
}

function resolveExistingAssetsForPersistGuard(
  key: string,
  cached: WorkflowProjectBundle | undefined
): WorkflowAsset[] {
  return resolveStoryboardAssetsForPersistGuard(key, cached);
}

/** 将 save 阶段补回的分镜表合并进当前 assets 列表（去重） */
export function mergeRestoredStoryboardAssetsIntoList(
  assets: WorkflowAsset[],
  restored: WorkflowAsset[]
): WorkflowAsset[] {
  if (!restored.length) return assets;
  const ids = new Set(assets.map((a) => String(a.id || '').trim()).filter(Boolean));
  const add: WorkflowAsset[] = [];
  for (const asset of restored) {
    const id = String(asset.id || '').trim();
    if (!id || ids.has(id)) continue;
    ids.add(id);
    add.push(asset);
  }
  if (!add.length) return assets;
  return [...assets, ...add];
}

export function saveWorkflowBundle(
  projectId: string,
  bundle: WorkflowProjectBundle,
  persistUserId: WorkspacePersistUserId = null,
  opts?: SaveWorkflowBundleOptions
): SaveWorkflowBundleResult {
  const key = workflowBundleStorageKey(projectId, persistUserId);
  const cached = bundleMemoryCache.get(key);
  const existingAssets = resolveExistingAssetsForPersistGuard(key, cached);
  const { bundle: snapshot, restoredStoryboardAssets } = mergePreservingStoryboardTableAssets(
    cloneBundle(bundle),
    existingAssets,
    opts
  );
  snapshot.workflowBundleSchemaVersion = WORKFLOW_BUNDLE_SCHEMA_CURRENT;
  if (
    shouldBlockEmptyWorkflowBundlePersist(snapshot, {
      existingAssetCount: Math.max(
        cached?.assets.length ?? 0,
        countWorkflowBundleAssetsInJson(readLocalString(key))
      ),
      allowEmptyOverwrite: opts?.allowEmptyOverwrite,
    })
  ) {
    console.warn('[workspace] refused in-memory empty save over known non-empty bundle', key);
    if (cached) {
      return { saved: false, restoredStoryboardAssets: restoredStoryboardAssets };
    }
    if (rawHasAssets(readLocalString(key))) {
      loadWorkflowBundle(projectId, persistUserId);
      return { saved: false, restoredStoryboardAssets: restoredStoryboardAssets };
    }
  }
  bundleMemoryCache.set(key, snapshot);
  syncStoryboardPersistGuardFromAssets(key, snapshot.assets, opts?.explicitlyRemovedStoryboardIds);
  const payload = JSON.stringify(stripWorkflowBundleForIdbPersist(snapshot));
  schedulePersistToIdb(key, payload, opts);
  return { saved: true, restoredStoryboardAssets };
}

function rawHasAssets(raw: string | null): boolean {
  return countWorkflowBundleAssetsInJson(raw) > 0;
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
        loadBundleIntoMemoryCache(key, fromIdb);
        continue;
      }
      const raw = readLocalString(key);
      if (raw) {
        loadBundleIntoMemoryCache(key, raw);
        const cached = bundleMemoryCache.get(key);
        if (cached) {
          await idbSaveBundleJson(
            key,
            JSON.stringify(stripWorkflowBundleForIdbPersist(cached))
          ).catch(() => {});
        }
        removeLocalKey(key);
      }
    } catch (e) {
      console.warn('[workspace] hydrate bundle failed', key, e);
      lastWorkflowBundleLoadDegraded = true;
      try {
        const fromIdb = await idbLoadBundleJson(key);
        const raw = fromIdb ?? readLocalString(key);
        if (raw) loadBundleIntoMemoryCache(key, raw);
      } catch (recoverErr) {
        console.warn('[workspace] hydrate bundle raw recover failed', key, recoverErr);
      }
    }
  }
}

/** 与 saveWorkflowBundle 相同，但配额等错误不抛，供 pagehide 等场景尽力持久化 */
export function trySaveWorkflowBundle(
  projectId: string,
  bundle: WorkflowProjectBundle,
  persistUserId: WorkspacePersistUserId = null,
  opts?: SaveWorkflowBundleOptions
): SaveWorkflowBundleResult {
  try {
    return saveWorkflowBundle(projectId, bundle, persistUserId, opts);
  } catch {
    return { saved: false, restoredStoryboardAssets: [] };
  }
}

export function removeWorkflowBundle(projectId: string, persistUserId: WorkspacePersistUserId = null): void {
  const key = workflowBundleStorageKey(projectId, persistUserId);
  bundleMemoryCache.delete(key);
  storyboardPersistGuardByKey.delete(key);
  pendingIdbPayloadByKey.delete(key);
  cancelledIdbBundleKeys.add(key);
  removeLocalKey(key);
  void idbDeleteBundle(key);
}
