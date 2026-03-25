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

/** R2 对象路径：users/&lt;userId&gt;/workspace/… */
export function workspaceRootPrefix(userId: string): string {
  return `users/${userId}/workspace`;
}

export function workspaceProjectsIndexKey(userId: string): string {
  return `${workspaceRootPrefix(userId)}/projects-index.json`;
}

export function workspaceWorkflowKey(userId: string, projectId: string): string {
  return `${workspaceRootPrefix(userId)}/projects/${projectId}/workflow.json`;
}

export type WorkspaceCloudIndexV1 = {
  version: 1;
  updatedAt: number;
  lastOpenProjectId: string | null;
  projects: WorkspaceProject[];
};

type UploadUrlResponse = { uploadUrl: string; objectKey: string };
type DownloadUrlResponse = { downloadUrl: string; objectKey: string };

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

/** 删除该项目前缀下「未被当前 workflow 引用」的对象（删图/删资产后同步 bucket） */
async function pruneUnreferencedProjectObjects(
  userId: string,
  projectId: string,
  referencedKeys: Set<string>
): Promise<void> {
  const workflowKey = workspaceWorkflowKey(userId, projectId);
  const keep = new Set(referencedKeys);
  keep.add(workflowKey);
  const prefix = `${workspaceRootPrefix(userId)}/projects/${projectId}/`;
  const listed = await listAllObjectKeysWithPrefix(prefix);
  for (const key of listed) {
    if (!keep.has(key)) await deleteWorkspaceObject(key);
  }
}

export async function fetchWorkspaceCloudIndex(userId: string): Promise<WorkspaceCloudIndexV1 | null> {
  const raw = await downloadR2ObjectText(workspaceProjectsIndexKey(userId));
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
  projectId: string
): Promise<{ version: number; assets: WorkflowAsset[]; pending: WorkflowPendingTask[] } | null> {
  let raw: string | null;
  try {
    raw = await downloadR2ObjectText(workspaceWorkflowKey(userId, projectId));
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
  projectId: string
): Promise<{ assets: WorkflowAsset[]; pending: WorkflowPendingTask[] } | null> {
  const packed = await fetchWorkflowPackedFromCloud(userId, projectId);
  if (!packed) return null;
  if (packed.version === 2) {
    return hydrateWorkflowBundleFromCloud({ assets: packed.assets, pending: packed.pending });
  }
  return { assets: packed.assets, pending: packed.pending };
}

export async function pushWorkspaceIndex(userId: string, projects: WorkspaceProject[], lastOpenProjectId: string | null): Promise<void> {
  const index: WorkspaceCloudIndexV1 = {
    version: 1,
    updatedAt: Date.now(),
    lastOpenProjectId,
    projects,
  };
  /** 与预签名一致用纯 application/json，避免部分 R2/S3 对 charset 签名与浏览器头不一致导致 403 */
  await putObjectBytes(workspaceProjectsIndexKey(userId), 'application/json', JSON.stringify(index));
}

export async function pushWorkflowBundleToCloud(
  userId: string,
  projectId: string,
  bundle: { assets: WorkflowAsset[]; pending: WorkflowPendingTask[] }
): Promise<void> {
  const packed = await packWorkflowBundleForCloud(userId, projectId, bundle);
  await putObjectBytes(workspaceWorkflowKey(userId, projectId), 'application/json', JSON.stringify(packed));
  const referenced = collectReferencedObjectKeysFromPackedV2(packed);
  await pruneUnreferencedProjectObjects(userId, projectId, referenced);
}

/** 删除某项目下所有 R2 对象（workflow.json、assets/、pending/ 等），避免孤儿图片 */
export async function deleteWorkspaceProjectObjects(userId: string, projectId: string): Promise<void> {
  const prefix = `${workspaceRootPrefix(userId)}/projects/${projectId}/`;
  const keys = await listAllObjectKeysWithPrefix(prefix);
  for (const key of keys) await deleteWorkspaceObject(key);
}

/**
 * 云端无索引时，仅把「访客站点级」localStorage 中的项目与工作流推到 R2（避免把上一登录账号的隔离数据误迁入）。
 * 成功后写入当前用户的隔离 local 副本。
 */
export async function migrateLocalWorkspaceToCloud(
  userId: string
): Promise<{ projects: WorkspaceProject[]; lastOpenProjectId: string | null } | null> {
  let indexRaw: string | null;
  try {
    indexRaw = await downloadR2ObjectText(workspaceProjectsIndexKey(userId));
  } catch {
    return null;
  }
  if (indexRaw != null) return null;
  const projects = loadWorkspaceProjects(null);
  const lastOpen = getLastOpenedWorkspaceProjectId(null);
  await pushWorkspaceIndex(userId, projects, lastOpen);
  for (const p of projects) {
    const b = loadWorkflowBundle(p.id, null);
    await pushWorkflowBundleToCloud(userId, p.id, b);
  }
  saveWorkspaceProjects(projects, userId);
  setLastOpenedWorkspaceProjectId(lastOpen, userId);
  for (const p of projects) {
    const b = loadWorkflowBundle(p.id, null);
    saveWorkflowBundle(p.id, b, userId);
  }
  return { projects, lastOpenProjectId: lastOpen };
}

