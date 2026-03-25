import type { WorkflowAsset, WorkflowPendingTask } from '../types';

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

function workflowBundleStorageKey(projectId: string, persistUserId: WorkspacePersistUserId): string {
  return persistUserId
    ? `ac_workflow_bundle_v1__u_${persistUserId}_${projectId}`
    : `ac_workflow_bundle_v1_${projectId}`;
}

export type WorkflowProjectBundle = {
  assets: WorkflowAsset[];
  pending: WorkflowPendingTask[];
};

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
  try {
    const raw = localStorage.getItem(workflowBundleStorageKey(projectId, persistUserId));
    if (!raw) return { assets: [], pending: [] };
    const data = JSON.parse(raw) as Partial<WorkflowProjectBundle>;
    return {
      assets: Array.isArray(data.assets) ? data.assets : [],
      pending: Array.isArray(data.pending) ? data.pending : [],
    };
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
  const payload = JSON.stringify(bundle);
  try {
    localStorage.setItem(key, payload);
  } catch (e) {
    const name = typeof DOMException !== 'undefined' && e instanceof DOMException ? e.name : '';
    if (name === 'QuotaExceededError' || (e instanceof Error && /quota/i.test(e.message))) {
      console.error(
        '[workspace] localStorage 空间不足，项目画布未能完整保存。请清理站点数据、减少大图数量，或确保已登录并启用云端同步（R2）。'
      );
    } else {
      console.error('[workspace] 保存失败', e);
    }
    throw e;
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
  localStorage.removeItem(workflowBundleStorageKey(projectId, persistUserId));
}
