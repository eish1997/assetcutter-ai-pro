/**
 * Agent CLI → 工作台：项目列表与资产网格的合并（无 MCP）。
 * 使用会话 Cookie（credentials: include）拉取当前登录用户的 CLI 产出。
 */
import { resolvedAuthApiBaseUrl } from './apiBase';
import type { WorkflowAsset } from '../types';
import type { WorkspaceProject } from './workspaceProjectStore';

export type AgentCliPlatformAsset = {
  id: string;
  name: string;
  kind: string;
  url: string | null;
  projectId: string;
  prompt?: string;
  createdAt: string;
  source: 'agent-cli';
  meta?: Record<string, unknown>;
};

export type AgentCliPlatformProject = {
  id: string;
  name: string;
  userId?: string;
  username?: string;
  source?: string;
  createdAt: string;
  updatedAt?: string;
};

function agentCliApiUrl(path: string): string {
  const base = resolvedAuthApiBaseUrl();
  if (base) return `${base.replace(/\/+$/, '')}${path}`;
  return path;
}

export function isAgentCliProjectId(projectId: string | null | undefined): boolean {
  return String(projectId || '').startsWith('agp_');
}

export async function fetchAgentCliPlatformProjects(): Promise<AgentCliPlatformProject[]> {
  try {
    const res = await fetch(agentCliApiUrl('/api/agent/cli/projects'), {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { ok?: boolean; projects?: AgentCliPlatformProject[] };
    return Array.isArray(data.projects) ? data.projects : [];
  } catch {
    return [];
  }
}

export async function fetchAgentCliPlatformAssets(
  limit = 100,
  projectId?: string,
): Promise<AgentCliPlatformAsset[]> {
  try {
    const q = new URLSearchParams();
    q.set('limit', String(limit));
    if (projectId) q.set('projectId', projectId);
    const res = await fetch(agentCliApiUrl(`/api/agent/cli/assets?${q}`), {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { ok?: boolean; assets?: AgentCliPlatformAsset[] };
    return Array.isArray(data.assets) ? data.assets : [];
  } catch {
    return [];
  }
}

export function agentCliProjectToWorkspaceProject(p: AgentCliPlatformProject): WorkspaceProject {
  const createdMs = Date.parse(String(p.createdAt || '')) || Date.now();
  return {
    id: String(p.id),
    name: String(p.name || 'Agent CLI 项目').trim() || 'Agent CLI 项目',
    createdAt: createdMs,
    source: 'agent-cli',
  };
}

/** CLI 项目置顶合并进工作台列表；同 id 保留本地字段但标记 source */
export function mergeAgentCliProjectsIntoWorkspace(
  current: WorkspaceProject[],
  cliProjects: AgentCliPlatformProject[],
): WorkspaceProject[] {
  if (!cliProjects.length) return current;
  const byId = new Map(current.map((p) => [String(p.id), p]));
  let changed = false;
  for (const raw of cliProjects) {
    const mapped = agentCliProjectToWorkspaceProject(raw);
    const existing = byId.get(mapped.id);
    if (!existing) {
      byId.set(mapped.id, mapped);
      changed = true;
      continue;
    }
    if (existing.source !== 'agent-cli' || existing.name !== mapped.name) {
      byId.set(mapped.id, {
        ...existing,
        name: mapped.name || existing.name,
        source: 'agent-cli',
        createdAt: existing.createdAt || mapped.createdAt,
      });
      changed = true;
    }
  }
  if (!changed) return current;
  const cliIds = new Set(cliProjects.map((p) => String(p.id)));
  const cliOrdered = cliProjects.map((p) => byId.get(String(p.id))!).filter(Boolean);
  const rest = current.filter((p) => !cliIds.has(String(p.id)));
  return [...cliOrdered, ...rest];
}

/** Map Agent CLI asset into a WorkflowAsset card for the grid. */
export function agentCliAssetToWorkflowAsset(a: AgentCliPlatformAsset): WorkflowAsset {
  const url = a.url || '';
  return {
    id: a.id,
    assetKind: a.kind === 'image' ? 'image' : 'file',
    textTitle: a.name,
    original: url,
    displayKey: 'original',
    results: {},
    resultOrder: [],
    createdAt: a.createdAt,
    tags: ['agent-cli'],
    meta: {
      ...(a.meta || {}),
      source: 'agent-cli',
      agentCliProjectId: a.projectId,
      prompt: a.prompt,
    },
  } as WorkflowAsset;
}

export function mergeAgentCliAssetsIntoWorkflow(
  current: WorkflowAsset[],
  agentAssets: AgentCliPlatformAsset[],
): WorkflowAsset[] {
  if (!agentAssets.length) return current;
  const ids = new Set(current.map((a) => a.id));
  const extras = agentAssets
    .filter((a) => a.id && !ids.has(a.id))
    .map(agentCliAssetToWorkflowAsset);
  if (!extras.length) return current;
  return [...extras, ...current];
}
