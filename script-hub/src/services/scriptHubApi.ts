import { requestJson } from './httpClient';
import { scriptHubApiUrl } from './authClient';
import type { ParamSchemaV1, ScriptDetail, ScriptHubRun, ScriptListItem, TargetType } from '../types/scriptHub';

export async function listScripts(): Promise<{ scripts: ScriptListItem[] }> {
  return requestJson(scriptHubApiUrl('/api/scripts'));
}

export async function createScript(body: {
  title: string;
  slug: string;
  targetType: 'maya' | 'unreal';
  description?: string;
}): Promise<{ script: ScriptDetail }> {
  return requestJson(scriptHubApiUrl('/api/scripts'), {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function getScript(id: string): Promise<{ script: ScriptDetail }> {
  return requestJson(scriptHubApiUrl(`/api/scripts/${encodeURIComponent(id)}`));
}

export async function updateScript(
  id: string,
  patch: Partial<{ title: string; description: string; visibility: string }>,
): Promise<{ script: ScriptDetail }> {
  return requestJson(scriptHubApiUrl(`/api/scripts/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteScript(id: string): Promise<{ ok: boolean }> {
  return requestJson(scriptHubApiUrl(`/api/scripts/${encodeURIComponent(id)}`), { method: 'DELETE' });
}

export async function createRevision(
  scriptId: string,
  body: { schema: ParamSchemaV1; content: string; changelog?: string },
): Promise<{
  ok: boolean;
  revision: { revisionId: string; version: number; sha256: string; byteSize: number; storageKey?: string };
}> {
  return requestJson(scriptHubApiUrl(`/api/scripts/${encodeURIComponent(scriptId)}/revisions`), {
    method: 'POST',
    body: JSON.stringify({ schema: body.schema, content: body.content, changelog: body.changelog ?? '' }),
  });
}

export async function getRevisionContent(scriptId: string, revisionId: string) {
  return requestJson<{
    content: string;
    schema: ParamSchemaV1;
    version: number;
  }>(
    scriptHubApiUrl(
      `/api/scripts/${encodeURIComponent(scriptId)}/revisions/${encodeURIComponent(revisionId)}/content`,
    ),
  );
}

/** 为伴侣拉 revision 正文签发短期 JWT（需登录 + CSRF） */
export async function issueRevisionContentToken(
  scriptId: string,
  revisionId: string,
): Promise<{ token: string; expiresIn: number }> {
  return requestJson(scriptHubApiUrl(`/api/scripts/${encodeURIComponent(scriptId)}/revisions/${encodeURIComponent(revisionId)}/content-token`), {
    method: 'POST',
    body: '{}',
  });
}

export async function createScriptRun(body: {
  scriptId: string;
  revisionId: string;
  targetType: TargetType;
  params: Record<string, unknown>;
  client?: string;
}): Promise<{ run: ScriptHubRun }> {
  return requestJson(scriptHubApiUrl('/api/runs'), {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function patchScriptRun(
  runId: string,
  patch: Partial<{
    status: string;
    companionJobId: string;
    exitCode: number | null;
    errorCode: string;
    errorMessage: string;
    logExcerpt: string;
    durationMs: number | null;
  }>,
): Promise<{ run: ScriptHubRun }> {
  return requestJson(scriptHubApiUrl(`/api/runs/${encodeURIComponent(runId)}`), {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function listScriptRuns(options?: { limit?: number; scriptId?: string }): Promise<{ runs: ScriptHubRun[] }> {
  const q = new URLSearchParams();
  if (options?.limit != null) q.set('limit', String(options.limit));
  if (options?.scriptId) q.set('scriptId', options.scriptId);
  const qs = q.toString();
  return requestJson(scriptHubApiUrl(qs ? `/api/runs?${qs}` : '/api/runs'));
}
