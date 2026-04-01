import type { WorkflowAsset, WorkflowPendingTask } from '../types';
import { r2ApiUrl } from './apiBase';
import { requestJson } from './httpClient';
import {
  collectReferencedObjectKeysFromPackedV2,
  hydrateWorkflowBundleFromCloud,
  packWorkflowBundleForCloud,
} from './workspaceR2ImageBundle';
import {
  getLastOpenedWorkspaceProjectId,
  loadWorkflowBundle,
  loadWorkspaceProjects,
  saveWorkflowBundle,
  saveWorkspaceProjects,
  setLastOpenedWorkspaceProjectId,
  type WorkspaceProject,
} from './workspaceProjectStore';

/** 与后端默认一致：未返回 quota 时前端展示用 */
export const WORKSPACE_CLOUD_DEFAULT_QUOTA_BYTES = 200 * 1024 * 1024;

/** 设为 `false` 时关闭工作区云同步（仅本地 localStorage） */
export function isWorkspaceCloudEnabled(): boolean {
  return import.meta.env.VITE_WORKSPACE_CLOUD !== 'false';
}

function sanitizeUserPathSegment(s: string): string {
  return String(s || '')
    .trim()
    .replace(/[^a-zA-Z0-9_.-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

function userStorageDirName(userId: string, username?: string | null): string {
  const uid = String(userId || '').trim();
  const name = sanitizeUserPathSegment(username || '');
  return name ? `${name}-${uid}` : uid;
}

/** R2 对象路径：users/&lt;username-userId&gt;/workspace/… */
export function workspaceRootPrefix(userId: string, username?: string | null): string {
  return `users/${userStorageDirName(userId, username)}/workspace`;
}

export function workspaceProjectsIndexKey(userId: string, username?: string | null): string {
  return `${workspaceRootPrefix(userId, username)}/projects-index.json`;
}

export function workspaceWorkflowKey(userId: string, projectId: string, username?: string | null): string {
  return `${workspaceRootPrefix(userId, username)}/projects/${projectId}/workflow.json`;
}

export type WorkspaceCloudIndexV1 = {
  version: 1;
  updatedAt: number;
  lastOpenProjectId: string | null;
  projects: WorkspaceProject[];
};

type UploadUrlResponse = { uploadUrl: string; objectKey: string };
type DownloadUrlResponse = { downloadUrl: string; objectKey: string };
type ReconcileRefsResponse = { ok: boolean; deletedKeys?: string[] };

function getCsrfHeader(): Record<string, string> {
  if (typeof document === 'undefined') return {};
  const cookies = document.cookie ? document.cookie.split(';') : [];
  for (const raw of cookies) {
    const [k, ...rest] = raw.trim().split('=');
    if (k === 'ac_csrf') return { 'X-CSRF-Token': decodeURIComponent(rest.join('=') || '') };
  }
  return {};
}

async function putObjectBytes(objectKey: string, contentType: string, body: string | ArrayBuffer | Blob): Promise<void> {
  const { uploadUrl } = await requestJson<UploadUrlResponse>(r2ApiUrl('/upload-url'), {
    method: 'POST',
    body: JSON.stringify({ objectKey, contentType, expiresIn: 900 }),
  });
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body,
  });
  if (!put.ok) throw new Error(`R2 上传失败（${put.status}）`);
  await requestJson<{ ok?: boolean }>(r2ApiUrl('/register-upload'), {
    method: 'POST',
    body: JSON.stringify({ objectKey }),
  });
}

/** 云端无此对象时返回 null；鉴权/网络失败时抛错 */
async function downloadR2ObjectText(objectKey: string): Promise<string | null> {
  const { downloadUrl } = await requestJson<DownloadUrlResponse>(r2ApiUrl('/download-url'), {
    method: 'POST',
    body: JSON.stringify({ objectKey, expiresIn: 300 }),
  });
  const r = await fetch(downloadUrl);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`R2 读取失败（${r.status}）`);
  return await r.text();
}

export async function deleteWorkspaceObject(objectKey: string): Promise<void> {
  const res = await fetch(r2ApiUrl(`/objects/${encodeURIComponent(objectKey)}`), {
    method: 'DELETE',
    credentials: 'include',
    headers: getCsrfHeader(),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status === 404) return;
  if (!res.ok) throw new Error(data.error || `删除失败（${res.status}）`);
}

async function listAllObjectKeysWithPrefix(prefix: string): Promise<string[]> {
  const out: string[] = [];
  let token: string | null = null;
  for (;;) {
    const q = new URLSearchParams({ prefix, maxKeys: '1000' });
    if (token) q.set('continuationToken', token);
    const data = await requestJson<{
      items: Array<{ key: string }>;
      isTruncated: boolean;
      nextContinuationToken: string | null;
    }>(r2ApiUrl(`/objects?${q.toString()}`), { method: 'GET' });
    for (const it of data.items) {
      if (it.key) out.push(it.key);
    }
    if (data.isTruncated && data.nextContinuationToken) token = data.nextContinuationToken;
    else break;
  }
  return out;
}

async function reconcileWorkspaceObjectRefs(addKeys: string[], removeKeys: string[]): Promise<void> {
  const add = [...new Set(addKeys.filter((k) => !!k?.trim()))];
  const remove = [...new Set(removeKeys.filter((k) => !!k?.trim()))];
  if (!add.length && !remove.length) return;
  await requestJson<ReconcileRefsResponse>(r2ApiUrl('/object-refs/reconcile'), {
    method: 'POST',
    body: JSON.stringify({ addKeys: add, removeKeys: remove }),
  });
}

/** 删除该项目前缀下「未被当前 workflow 引用」的对象（删图/删资产后同步 bucket） */
async function pruneUnreferencedProjectObjects(
  userId: string,
  projectId: string,
  referencedKeys: Set<string>,
  username?: string | null
): Promise<void> {
  const workflowKey = workspaceWorkflowKey(userId, projectId, username);
  const keep = new Set(referencedKeys);
  keep.add(workflowKey);
  const prefix = `${workspaceRootPrefix(userId, username)}/projects/${projectId}/`;
  const listed = await listAllObjectKeysWithPrefix(prefix);
  for (const key of listed) {
    if (!keep.has(key)) await deleteWorkspaceObject(key);
  }
}

export async function fetchWorkspaceCloudIndex(userId: string, username?: string | null): Promise<WorkspaceCloudIndexV1 | null> {
  const raw = await downloadR2ObjectText(workspaceProjectsIndexKey(userId, username));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as WorkspaceCloudIndexV1;
    if (parsed?.version !== 1 || !Array.isArray(parsed.projects)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 仅拉取并解析 workflow.json（含 v2 占位键），不下载 R2 图像 */
export async function fetchWorkflowPackedFromCloud(
  userId: string,
  projectId: string,
  username?: string | null
): Promise<{ version: number; assets: WorkflowAsset[]; pending: WorkflowPendingTask[] } | null> {
  let raw: string | null;
  try {
    raw = await downloadR2ObjectText(workspaceWorkflowKey(userId, projectId, username));
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as { version?: number; assets?: WorkflowAsset[]; pending?: WorkflowPendingTask[] };
    const assets = Array.isArray(data.assets) ? data.assets : [];
    const pending = Array.isArray(data.pending) ? data.pending : [];
    const version = data.version === 2 ? 2 : 1;
    return { version, assets, pending };
  } catch {
    return null;
  }
}

export async function fetchWorkflowBundleFromCloud(
  userId: string,
  projectId: string,
  username?: string | null
): Promise<{ assets: WorkflowAsset[]; pending: WorkflowPendingTask[] } | null> {
  const packed = await fetchWorkflowPackedFromCloud(userId, projectId, username);
  if (!packed) return null;
  if (packed.version === 2) {
    return hydrateWorkflowBundleFromCloud({ assets: packed.assets, pending: packed.pending });
  }
  return { assets: packed.assets, pending: packed.pending };
}

export async function pushWorkspaceIndex(
  userId: string,
  projects: WorkspaceProject[],
  lastOpenProjectId: string | null,
  username?: string | null
): Promise<void> {
  const index: WorkspaceCloudIndexV1 = {
    version: 1,
    updatedAt: Date.now(),
    lastOpenProjectId,
    projects,
  };
  /** 与预签名一致用纯 application/json，避免部分 R2/S3 对 charset 签名与浏览器头不一致导致 403 */
  await putObjectBytes(workspaceProjectsIndexKey(userId, username), 'application/json', JSON.stringify(index));
}

export async function pushWorkflowBundleToCloud(
  userId: string,
  projectId: string,
  bundle: { assets: WorkflowAsset[]; pending: WorkflowPendingTask[] },
  username?: string | null,
  options?: { pruneUnreferenced?: boolean }
): Promise<void> {
  const prevPacked = await fetchWorkflowPackedFromCloud(userId, projectId, username);
  const packed = await packWorkflowBundleForCloud(userId, projectId, bundle, username);
  const prevRefs = prevPacked ? collectReferencedObjectKeysFromPackedV2(prevPacked) : new Set<string>();
  const nextRefs = collectReferencedObjectKeysFromPackedV2(packed);
  const addKeys = [...nextRefs].filter((k) => !prevRefs.has(k));
  const removeKeys = [...prevRefs].filter((k) => !nextRefs.has(k));
  await reconcileWorkspaceObjectRefs(addKeys, removeKeys);
  await putObjectBytes(workspaceWorkflowKey(userId, projectId, username), 'application/json', JSON.stringify(packed));
  if (options?.pruneUnreferenced !== false) {
    await pruneUnreferencedProjectObjects(userId, projectId, nextRefs, username);
  }
}

/** 删除某项目下所有 R2 对象（workflow.json、assets/、pending/ 等），避免孤儿图片 */
export async function deleteWorkspaceProjectObjects(userId: string, projectId: string, username?: string | null): Promise<void> {
  const prevPacked = await fetchWorkflowPackedFromCloud(userId, projectId, username);
  if (prevPacked) {
    const prevRefs = collectReferencedObjectKeysFromPackedV2(prevPacked);
    await reconcileWorkspaceObjectRefs([], [...prevRefs]);
  }
  const prefix = `${workspaceRootPrefix(userId, username)}/projects/${projectId}/`;
  const keys = await listAllObjectKeysWithPrefix(prefix);
  for (const key of keys) await deleteWorkspaceObject(key);
}

/**
 * 云端无索引时，仅把「访客站点级」localStorage 中的项目与工作流推到 R2（避免把上一登录账号的隔离数据误迁入）。
 * 成功后写入当前用户的隔离 local 副本。
 */
export async function migrateLocalWorkspaceToCloud(
  userId: string,
  username?: string | null
): Promise<{ projects: WorkspaceProject[]; lastOpenProjectId: string | null } | null> {
  let indexRaw: string | null;
  try {
    indexRaw = await downloadR2ObjectText(workspaceProjectsIndexKey(userId, username));
  } catch {
    return null;
  }
  if (indexRaw != null) return null;
  const projects = loadWorkspaceProjects(null);
  const lastOpen = getLastOpenedWorkspaceProjectId(null);
  await pushWorkspaceIndex(userId, projects, lastOpen, username);
  for (const p of projects) {
    const b = loadWorkflowBundle(p.id, null);
    await pushWorkflowBundleToCloud(userId, p.id, b, username);
  }
  saveWorkspaceProjects(projects, userId);
  setLastOpenedWorkspaceProjectId(lastOpen, userId);
  for (const p of projects) {
    const b = loadWorkflowBundle(p.id, null);
    saveWorkflowBundle(p.id, b, userId);
  }
  return { projects, lastOpenProjectId: lastOpen };
}

