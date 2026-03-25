import type { WorkflowAsset, WorkflowPendingTask } from '../types';

export type WorkspaceProject = {
  id: string;
  name: string;
  createdAt: number;
};

const PROJECTS_KEY = 'ac_workspace_projects_v1';
const LAST_OPEN_PROJECT_KEY = 'ac_workspace_last_open_v1';

const newId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 12));

export type WorkflowProjectBundle = {
  assets: WorkflowAsset[];
  pending: WorkflowPendingTask[];
};

function workflowBundleStorageKey(projectId: string) {
  return `ac_workflow_bundle_v1_${projectId}`;
}

export function loadWorkspaceProjects(): WorkspaceProject[] {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    let list: WorkspaceProject[] = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) list = [];
    if (list.length === 0) {
      const p: WorkspaceProject = { id: newId(), name: '默认项目', createdAt: Date.now() };
      list = [p];
      localStorage.setItem(PROJECTS_KEY, JSON.stringify(list));
    }
    return list;
  } catch {
    const p: WorkspaceProject = { id: newId(), name: '默认项目', createdAt: Date.now() };
    localStorage.setItem(PROJECTS_KEY, JSON.stringify([p]));
    return [p];
  }
}

export function saveWorkspaceProjects(projects: WorkspaceProject[]): void {
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
}

export function createWorkspaceProject(name: string): WorkspaceProject {
  const trimmed = name.trim();
  return {
    id: newId(),
    name: trimmed || '未命名项目',
    createdAt: Date.now(),
  };
}

export function getLastOpenedWorkspaceProjectId(): string | null {
  try {
    const id = localStorage.getItem(LAST_OPEN_PROJECT_KEY);
    if (!id) return null;
    const projects = loadWorkspaceProjects();
    return projects.some((p) => p.id === id) ? id : null;
  } catch {
    return null;
  }
}

/** 首屏恢复：上次打开的项目及其工作流数据（需在 loadWorkspaceProjects 之后调用） */
export function readInitialWorkflowProjectSession(): {
  activeProjectId: string | null;
  assets: WorkflowAsset[];
  pending: WorkflowPendingTask[];
} {
  const activeProjectId = getLastOpenedWorkspaceProjectId();
  if (!activeProjectId) return { activeProjectId: null, assets: [], pending: [] };
  const b = loadWorkflowBundle(activeProjectId);
  return { activeProjectId, assets: b.assets, pending: b.pending };
}

export function setLastOpenedWorkspaceProjectId(id: string | null): void {
  if (id == null) localStorage.removeItem(LAST_OPEN_PROJECT_KEY);
  else localStorage.setItem(LAST_OPEN_PROJECT_KEY, id);
}

export function loadWorkflowBundle(projectId: string): WorkflowProjectBundle {
  try {
    const raw = localStorage.getItem(workflowBundleStorageKey(projectId));
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

export function saveWorkflowBundle(projectId: string, bundle: WorkflowProjectBundle): void {
  const key = workflowBundleStorageKey(projectId);
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
export function trySaveWorkflowBundle(projectId: string, bundle: WorkflowProjectBundle): boolean {
  try {
    saveWorkflowBundle(projectId, bundle);
    return true;
  } catch {
    return false;
  }
}

export function removeWorkflowBundle(projectId: string): void {
  localStorage.removeItem(workflowBundleStorageKey(projectId));
}
