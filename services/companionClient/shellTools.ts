import { companionFetchJson } from './fetch';

export type CompanionShellToolSummaryV1 = {
  id: string;
  name: string;
  description: string;
  semver: string;
  icon?: string;
  tags?: string[];
  installedAt: string;
  permissions: string[];
};

export async function listCompanionShellTools(baseUrl: string) {
  return companionFetchJson<{ tools: CompanionShellToolSummaryV1[] }>(baseUrl, '/v1/shell-tools', {
    method: 'GET',
  });
}

export async function getCompanionShellTool(baseUrl: string, toolId: string) {
  return companionFetchJson<{
    tool: unknown;
    panel: unknown;
    permissions: string[];
    installedAt: string;
  }>(baseUrl, `/v1/shell-tools/${encodeURIComponent(toolId)}`, { method: 'GET' });
}

export async function runCompanionShellTool(
  baseUrl: string,
  toolId: string,
  body: { actionId?: string; params?: Record<string, unknown> },
) {
  return companionFetchJson<{
    ok: boolean;
    exitCode: number | null;
    stdout: string;
    stderr: string;
  }>(baseUrl, `/v1/shell-tools/${encodeURIComponent(toolId)}/run`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function uninstallCompanionShellTool(baseUrl: string, toolId: string) {
  return companionFetchJson<{ ok: boolean }>(baseUrl, `/v1/shell-tools/${encodeURIComponent(toolId)}`, {
    method: 'DELETE',
  });
}
