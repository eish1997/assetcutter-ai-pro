import type { AuthUser } from './authClient';
import { apiUrl, r2ApiUrl } from './apiBase';
import { HttpRequestError, requestJson } from './httpClient';

type UsersResponse = { users: AuthUser[]; total?: number; page?: number; pageSize?: number };

export type AdminUserSession = {
  id: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  ip: string;
  userAgent: string;
  active: boolean;
};

export type AdminUserLastLogin = {
  at: string;
  ip: string;
  userAgent: string;
};

export type AdminUserTrialGemini = {
  day: string;
  used: number;
  limit: number;
  remaining: number;
};

export type AdminUserDetailResponse = {
  user: AuthUser;
  lastLogin?: AdminUserLastLogin | null;
  sessions?: AdminUserSession[];
  trialGemini?: AdminUserTrialGemini;
};

type UserResponse = AdminUserDetailResponse;
type AuditLog = {
  id: string;
  actorUserId: string | null;
  actorIdentifier: string;
  action: string;
  targetUserId: string | null;
  meta: unknown;
  ip: string;
  userAgent: string;
  createdAt: string;
};
type AuditLogsResponse = {
  logs: AuditLog[];
  total?: number;
  limit?: number;
  offset?: number;
  nextCursor?: string | null;
  redacted?: boolean;
};

export type AuditRetentionMeta = {
  storage: 'postgres' | 'json';
  maxRecords: number | null;
  retentionDays: number | null;
  note: string;
};

export type AuditLogsMetaResponse = {
  retention: AuditRetentionMeta;
  redactedExportDefault: boolean;
};

export type AdminUsersQuery = {
  page?: number;
  pageSize?: number;
  q?: string;
  status?: '' | 'active' | 'disabled';
  staffRoleId?: string;
  quotaWarnPct?: number;
};

export async function fetchAdminUsers(query?: AdminUsersQuery) {
  const params = new URLSearchParams();
  if (query?.page) params.set('page', String(query.page));
  if (query?.pageSize) params.set('pageSize', String(query.pageSize));
  if (query?.q) params.set('q', query.q);
  if (query?.status) params.set('status', query.status);
  if (query?.staffRoleId) params.set('staffRoleId', query.staffRoleId);
  if (query?.quotaWarnPct != null && Number.isFinite(query.quotaWarnPct)) {
    params.set('quotaWarnPct', String(query.quotaWarnPct));
  }
  const qs = params.toString();
  return requestJson<UsersResponse>(apiUrl(`/api/admin/users${qs ? `?${qs}` : ''}`), { cache: 'no-store' });
}

export async function fetchAdminUser(userId: string) {
  const id = String(userId || '').trim();
  if (!id) throw new Error('无效用户 id');
  const queryUrl = apiUrl(`/api/admin/users?userId=${encodeURIComponent(id)}`);
  try {
    return await requestJson<AdminUserDetailResponse>(queryUrl, { cache: 'no-store' });
  } catch (err) {
    if (err instanceof HttpRequestError && err.status === 404) {
      return requestJson<AdminUserDetailResponse>(apiUrl(`/api/admin/users/${encodeURIComponent(id)}`), {
        cache: 'no-store',
      });
    }
    throw err;
  }
}

export async function downloadAdminUsersCsv(query: AdminUsersQuery = {}) {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.status) params.set('status', query.status);
  if (query.staffRoleId) params.set('staffRoleId', query.staffRoleId);
  if (query.quotaWarnPct != null && Number.isFinite(query.quotaWarnPct)) {
    params.set('quotaWarnPct', String(query.quotaWarnPct));
  }
  const qs = params.toString();
  const url = apiUrl(`/api/admin/users/export${qs ? `?${qs}` : ''}`);
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* non-json */
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') || '';
  const match = cd.match(/filename="([^"]+)"/);
  const filename = match?.[1] || `users-${new Date().toISOString().slice(0, 10)}.csv`;
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
  return {
    rows: Number(res.headers.get('X-Users-Export-Rows') || 0),
    total: Number(res.headers.get('X-Users-Export-Total') || 0),
    truncated: res.headers.get('X-Users-Export-Truncated') === '1',
  };
}

export type CapabilityPresetCatalogItem = {
  id?: string;
  type?: string;
  name?: string;
  desc?: string;
  version?: string;
  url?: string;
  updatedAt?: string;
  tags?: string[];
  previewUrl?: string;
};

export type CapabilityPresetPublishRecord = {
  id: string;
  at: string;
  actorIdentifier: string;
  presetId: string;
  catalogObjectKey: string;
  packObjectKey: string;
};

export type AdminCapabilityPresetsResponse = {
  configured: boolean;
  catalog: CapabilityPresetCatalogItem[];
  recentPublishes: CapabilityPresetPublishRecord[];
};

export async function fetchAdminCapabilityPresets() {
  return requestJson<AdminCapabilityPresetsResponse>(apiUrl('/api/admin/capability-presets'), {
    cache: 'no-store',
  });
}

export type CapabilityPresetBackup = {
  format: string;
  version: number;
  exportedAt: string;
  catalogObjectKey: string;
  catalog: CapabilityPresetCatalogItem[];
  presets: Record<string, unknown[]>;
};

export type CapabilityPresetImportMode = 'overwrite' | 'merge';

export type CapabilityPresetImportPreview = {
  mode: CapabilityPresetImportMode;
  added: string[];
  updated: string[];
  removed: string[];
  unchanged: string[];
  conflicts: Array<{
    id: string;
    onlineVersion: string;
    backupVersion: string;
    winner: 'backup' | 'online';
  }>;
  willWriteCount: number;
  willDeleteCount: number;
  finalCatalogCount: number;
};

export function extractPresetIdFromCatalogItem(item: CapabilityPresetCatalogItem): string {
  const catalogId = String(item.id || '').trim();
  if (catalogId.startsWith('preset_')) return catalogId.slice('preset_'.length);
  const url = String(item.url || '').trim();
  const m = url.match(/^\.\/presets\/([^/.]+)\.json$/i);
  if (m?.[1]) return m[1];
  return catalogId.replace(/^preset_/, '');
}

export async function downloadAdminCapabilityPresetsBackup() {
  const res = await fetch(apiUrl('/api/admin/capability-presets/export'), { credentials: 'include' });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* non-json */
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') || '';
  const match = cd.match(/filename="([^"]+)"/);
  const filename = match?.[1] || `capability-presets-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
  return { filename };
}

export async function previewAdminCapabilityPresetsImport(
  backup: CapabilityPresetBackup,
  mode: CapabilityPresetImportMode
) {
  return requestJson<{ ok: boolean; preview: CapabilityPresetImportPreview }>(
    apiUrl('/api/admin/capability-presets/import/preview'),
    {
      method: 'POST',
      body: JSON.stringify({ backup, mode }),
    }
  );
}

export async function importAdminCapabilityPresets(backup: CapabilityPresetBackup, mode: CapabilityPresetImportMode) {
  return requestJson<{
    ok: boolean;
    mode: CapabilityPresetImportMode;
    finalCatalogCount: number;
    writtenCount: number;
    deletedCount: number;
  }>(apiUrl('/api/admin/capability-presets/import'), {
    method: 'POST',
    body: JSON.stringify({ backup, mode }),
  });
}

export async function deleteAdminCapabilityPreset(presetId: string) {
  return requestJson<{ ok: boolean; presetId: string; deletedKeys: string[] }>(
    r2ApiUrl(`/capability-store/delete?presetId=${encodeURIComponent(presetId)}`),
    { method: 'DELETE' }
  );
}

export async function updateAdminUser(
  userId: string,
  patch: {
    role?: 'admin' | 'user';
    staffRoleId?: string | null;
    status?: 'active' | 'disabled';
    workspaceQuotaBytes?: number;
  }
) {
  return requestJson<UserResponse>(apiUrl(`/api/admin/users/${encodeURIComponent(userId)}`), {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function reconcileAdminUserWorkspaceUsage(userId: string, opts?: { force?: boolean }) {
  const q = opts?.force ? '?force=1' : '';
  return requestJson<{ ok: boolean; userId: string; workspaceUsedBytes: number; scannedKeys?: number }>(
    `${apiUrl(`/api/admin/users/${encodeURIComponent(userId)}/workspace-usage/reconcile`)}${q}`,
    { method: 'POST', body: '{}' }
  );
}

export type AuditLogsQuery = {
  limit?: number;
  offset?: number;
  action?: string;
  actor?: string;
  targetUserId?: string;
  from?: string;
  to?: string;
  category?: 'all' | 'admin' | 'auth' | 'release';
  excludeActions?: string;
  cursor?: string;
};

export async function fetchAuditLogs(query: AuditLogsQuery | number = 200) {
  const params = new URLSearchParams();
  if (typeof query === 'number') {
    params.set('limit', String(query));
  } else {
    if (query.limit != null) params.set('limit', String(query.limit));
    if (query.offset != null) params.set('offset', String(query.offset));
    if (query.action) params.set('action', query.action);
    if (query.actor) params.set('actor', query.actor);
    if (query.targetUserId) params.set('targetUserId', query.targetUserId);
    if (query.from) params.set('from', query.from);
    if (query.to) params.set('to', query.to);
    if (query.category && query.category !== 'all') params.set('category', query.category);
    if (query.excludeActions) params.set('excludeActions', query.excludeActions);
    if (query.cursor) params.set('cursor', query.cursor);
  }
  return requestJson<AuditLogsResponse>(apiUrl(`/api/admin/audit-logs?${params.toString()}`));
}

export async function fetchAuditLogsMeta() {
  return requestJson<AuditLogsMetaResponse>(apiUrl('/api/admin/audit-logs/meta'), { cache: 'no-store' });
}

export async function downloadAuditLogsCsv(query: Omit<AuditLogsQuery, 'limit' | 'offset'> = {}) {
  const params = new URLSearchParams();
  if (query.action) params.set('action', query.action);
  if (query.actor) params.set('actor', query.actor);
  if (query.targetUserId) params.set('targetUserId', query.targetUserId);
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  if (query.category && query.category !== 'all') params.set('category', query.category);
  if (query.excludeActions) params.set('excludeActions', query.excludeActions);
  const qs = params.toString();
  const url = apiUrl(`/api/admin/audit-logs/export${qs ? `?${qs}` : ''}`);
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* non-json */
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') || '';
  const match = cd.match(/filename="([^"]+)"/);
  const filename = match?.[1] || `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
  return {
    rows: Number(res.headers.get('X-Audit-Export-Rows') || 0),
    total: Number(res.headers.get('X-Audit-Export-Total') || 0),
    truncated: res.headers.get('X-Audit-Export-Truncated') === '1',
    redacted: res.headers.get('X-Audit-Export-Redacted') === '1',
  };
}

export type AuditQuickStats = {
  adminOps: number;
  loginFailed: number;
  releaseOps: number;
};

export async function fetchAuditQuickStats(query: Pick<AuditLogsQuery, 'from' | 'to'>): Promise<AuditQuickStats> {
  const base = { limit: 1, offset: 0, from: query.from, to: query.to };
  const [admin, loginFailed, release] = await Promise.all([
    fetchAuditLogs({ ...base, category: 'admin' }),
    fetchAuditLogs({ ...base, action: 'auth.login_failed' }),
    fetchAuditLogs({ ...base, category: 'release' }),
  ]);
  return {
    adminOps: admin.total ?? 0,
    loginFailed: loginFailed.total ?? 0,
    releaseOps: release.total ?? 0,
  };
}

export type TaskExecutionEvent = {
  id: string;
  source: 'workflow';
  userId: string;
  username?: string;
  ts: string;
  level: 'info' | 'warn' | 'error';
  code: string;
  message: string;
  assetId?: string | null;
  taskId?: string | null;
  displayKey?: string | null;
  detail?: Record<string, unknown> | null;
};

export type TaskEventsQuery = {
  limit?: number;
  userId?: string;
  from?: string;
  to?: string;
  level?: '' | 'info' | 'warn' | 'error';
  code?: string;
  taskId?: string;
  cursor?: string;
};

type TaskEventsResponse = {
  events: TaskExecutionEvent[];
  total?: number;
  limit?: number;
  nextCursor?: string | null;
  redacted?: boolean;
};

export async function fetchTaskExecutionEvents(query: TaskEventsQuery = {}) {
  const params = new URLSearchParams();
  if (query.limit != null) params.set('limit', String(query.limit));
  if (query.userId) params.set('userId', query.userId);
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  if (query.level) params.set('level', query.level);
  if (query.code) params.set('code', query.code);
  if (query.taskId) params.set('taskId', query.taskId);
  if (query.cursor) params.set('cursor', query.cursor);
  return requestJson<TaskEventsResponse>(apiUrl(`/api/admin/task-events?${params.toString()}`));
}

export type UsageEventRow = {
  id: string;
  idempotencyKey: string;
  userId: string;
  username?: string;
  provider: string;
  registryId?: string | null;
  billingSku: string;
  meterKind: string;
  quantityIn?: number | null;
  quantityOut?: number | null;
  quantity: number;
  unit: string;
  costUsdEst?: number | null;
  costConfidence: string;
  status: string;
  upstreamTaskId?: string | null;
  requestId?: string | null;
  jobKind?: string | null;
  projectId?: string | null;
  workflowStepId?: string | null;
  auditLogId?: string | null;
  createdAt: string;
  meta?: Record<string, unknown> | null;
};

export type UsageEventsQuery = {
  limit?: number;
  userId?: string;
  billingSku?: string;
  provider?: string;
  from?: string;
  to?: string;
  cursor?: string;
};

type UsageEventsResponse = {
  events: UsageEventRow[];
  total?: number;
  limit?: number;
  nextCursor?: string | null;
};

export type UsageSummaryResponse = {
  eventCount: number;
  totalQuantity: number;
  totalCostUsdEst: number;
  bySku: Array<{ billingSku: string; count: number; quantity: number; costUsdEst: number }>;
};

export async function fetchUsageEvents(query: UsageEventsQuery = {}) {
  const params = new URLSearchParams();
  if (query.limit != null) params.set('limit', String(query.limit));
  if (query.userId) params.set('userId', query.userId);
  if (query.billingSku) params.set('billingSku', query.billingSku);
  if (query.provider) params.set('provider', query.provider);
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  if (query.cursor) params.set('cursor', query.cursor);
  return requestJson<UsageEventsResponse>(apiUrl(`/api/admin/usage-events?${params.toString()}`));
}

export async function fetchUsageSummary(query: Omit<UsageEventsQuery, 'limit' | 'cursor'> = {}) {
  const params = new URLSearchParams();
  if (query.userId) params.set('userId', query.userId);
  if (query.billingSku) params.set('billingSku', query.billingSku);
  if (query.provider) params.set('provider', query.provider);
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  return requestJson<UsageSummaryResponse>(apiUrl(`/api/admin/usage-summary?${params.toString()}`));
}

export type ObservabilityTraceResponse = {
  correlationId: string;
  usage: {
    events: UsageEventRow[];
    total: number;
    eventCount: number;
    totalCostUsdEst: number;
  };
  taskEvents: {
    events: TaskExecutionEvent[];
    total: number;
  };
  redacted?: boolean;
};

export async function fetchObservabilityTrace(correlationId: string, limit = 100) {
  const params = new URLSearchParams();
  params.set('correlationId', correlationId);
  params.set('limit', String(limit));
  return requestJson<ObservabilityTraceResponse>(
    apiUrl(`/api/admin/observability/trace?${params.toString()}`)
  );
}

export type AdminSystemStatusPayload = {
  generatedAt: string;
  services: {
    authApi: { ok: boolean; service: string; port: number };
    geminiProxy: {
      ok: boolean;
      skipped?: boolean;
      reason?: string;
      url?: string;
      status?: number;
      error?: string;
      metrics?: {
        enabled: boolean;
        globalQueuedApprox: number;
        keysWithQueued: number;
        ringKeys: number;
        persistedKeysLoaded: number;
        configSource: string | null;
        geminiAsyncJobs: number;
        geminiProxyInFlight: number;
      } | null;
      vertex?: unknown;
    };
  };
  config: {
    flags: Array<{ name: string; configured: boolean }>;
    trialGeminiDailyLimit: number;
    geminiFairnessConfigSource: string | null;
    companionArtifactsRegistered: number;
  };
};

export async function fetchAdminSystemStatus() {
  return requestJson<AdminSystemStatusPayload>(apiUrl('/api/admin/system-status'), { cache: 'no-store' });
}

export type AdminAlertWebhookConfig = {
  enabled: boolean;
  url: string;
  urlMasked: string;
  loginFailedThreshold: number;
  loginFailedWindowMinutes: number;
};

export async function fetchAdminAlertWebhook() {
  return requestJson<{ config: AdminAlertWebhookConfig }>(apiUrl('/api/admin/alert-webhook'), {
    cache: 'no-store',
  });
}

export async function updateAdminAlertWebhook(patch: Partial<AdminAlertWebhookConfig>) {
  return requestJson<{ config: AdminAlertWebhookConfig }>(apiUrl('/api/admin/alert-webhook'), {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

export async function testAdminAlertWebhook() {
  return requestJson<{ ok: boolean }>(apiUrl('/api/admin/alert-webhook/test'), {
    method: 'POST',
    body: '{}',
  });
}

export type AdminStaffInvite = {
  id: string;
  staffRoleId: string;
  staffRoleSlug: string;
  staffRoleDisplayName: string;
  note: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  usedByUserId: string | null;
  revokedAt: string | null;
  createdByUserId: string | null;
  createdByIdentifier: string;
};

export async function fetchAdminStaffInvites() {
  return requestJson<{ invites: AdminStaffInvite[] }>(apiUrl('/api/admin/staff-invites'), {
    cache: 'no-store',
  });
}

export async function createAdminStaffInvite(body: { staffRoleId: string; note?: string; ttlDays?: number }) {
  return requestJson<{
    invite: AdminStaffInvite;
    token: string;
    registerPath: string;
  }>(apiUrl('/api/admin/staff-invites'), {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function revokeAdminStaffInvite(inviteId: string) {
  return requestJson<{ invite: AdminStaffInvite }>(
    apiUrl(`/api/admin/staff-invites/${encodeURIComponent(inviteId)}`),
    { method: 'DELETE', body: '{}' }
  );
}

