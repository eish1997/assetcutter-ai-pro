import type { WorkflowAsset, WorkflowPendingTask } from '../types';
import { idbDeleteBundle, idbLoadBundleJson, idbSaveBundleJson } from './workspaceBundleIdb';

export type WorkspaceProject = {
  id: string;
  name: string;
  createdAt: number;
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

export type WorkflowProjectBundle = {
  assets: WorkflowAsset[];
  pending: WorkflowPendingTask[];
};

const bundleMemoryCache = new Map<string, WorkflowProjectBundle>();
/** 同一 bundle 连续保存时只保留待写入 JSON，避免排队多次完整 IDB 写入 */
const pendingIdbPayloadByKey = new Map<string, string>();
const pendingIdbWrites = new Map<string, Promise<void>>();
/** removeWorkflowBundle 后跳过已在队列中的写入，避免删项又被写回 IDB */
const cancelledIdbBundleKeys = new Set<string>();

function cloneBundle(b: WorkflowProjectBundle): WorkflowProjectBundle {
  return JSON.parse(JSON.stringify(b)) as WorkflowProjectBundle;
}

function parseBundleJson(raw: string): WorkflowProjectBundle {
  const data = JSON.parse(raw) as Partial<WorkflowProjectBundle>;
  return {
    assets: Array.isArray(data.assets) ? data.assets : [],
    pending: Array.isArray(data.pending) ? data.pending : [],
  };
}

function schedulePersistToIdb(bundleKey: string, json: string): void {
  if (typeof indexedDB === 'undefined') {
    try {
      localStorage.setItem(bundleKey, json);
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
          try {
            localStorage.removeItem(bundleKey);
          } catch {
            /* ignore */
          }
        } catch (e) {
          console.warn('[workspace] IndexedDB 保存失败，回退 localStorage', e);
          try {
            localStorage.setItem(bundleKey, payload);
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
          try {
            localStorage.removeItem(bundleKey);
          } catch {
            /* ignore */
          }
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
    const raw = localStorage.getItem(pk);
    let list: WorkspaceProject[] = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) list = [];
    if (list.length === 0) {
      const p: WorkspaceProject = { id: newId(), name: '默认项目', createdAt: Date.now() };
      list = [p];
      localStorage.setItem(pk, JSON.stringify(list));
    }
    return list;
  } catch {
    const p: WorkspaceProject = { id: newId(), name: '默认项目', createdAt: Date.now() };
    localStorage.setItem(pk, JSON.stringify([p]));
    return [p];
  }
}

export function saveWorkspaceProjects(projects: WorkspaceProject[], persistUserId: WorkspacePersistUserId = null): void {
  localStorage.setItem(projectsStorageKey(persistUserId), JSON.stringify(projects));
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
    const id = localStorage.getItem(lastOpenStorageKey(persistUserId));
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
  if (id == null) localStorage.removeItem(lk);
  else localStorage.setItem(lk, id);
}

export function loadWorkflowBundle(projectId: string, persistUserId: WorkspacePersistUserId = null): WorkflowProjectBundle {
  const key = workflowBundleStorageKey(projectId, persistUserId);
  const cached = bundleMemoryCache.get(key);
  if (cached) return cloneBundle(cached);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { assets: [], pending: [] };
    const bundle = parseBundleJson(raw);
    bundleMemoryCache.set(key, cloneBundle(bundle));
    return bundle;
  } catch {
    return { assets: [], pending: [] };
  }
}

export function saveWorkflowBundle(
  projectId: string,
  bundle: WorkflowProjectBundle,
  persistUserId: WorkspacePersistUserId = null
): void {
  const key = workflowBundleStorageKey(projectId, persistUserId);
  const snapshot = cloneBundle(bundle);
  bundleMemoryCache.set(key, snapshot);
  const payload = JSON.stringify(snapshot);
  schedulePersistToIdb(key, payload);
}

/** 等待正在进行的 IndexedDB 写入完成（供 pagehide / 关页前尽力落盘） */
export async function flushWorkspaceBundleIdbWrites(): Promise<void> {
  const pending = [...pendingIdbWrites.values()];
  if (pending.length === 0) return;
  await Promise.allSettled(pending);
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
      const raw = localStorage.getItem(key);
      if (raw) {
        const bundle = parseBundleJson(raw);
        bundleMemoryCache.set(key, cloneBundle(bundle));
        await idbSaveBundleJson(key, raw).catch(() => {});
        try {
          localStorage.removeItem(key);
        } catch {
          /* ignore */
        }
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
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
  void idbDeleteBundle(key);
}
