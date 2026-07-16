import { apiUrl } from './apiBase';
import { requestJson } from './httpClient';

export type AdminDashboardPayload = {
  generatedAt: string;
  stats: {
    totalUsers: number;
    registrations7d: number;
    loginFailed7d: number;
    adminOps7d: number;
    taskEvents7d: number;
    staffUsers: number;
  };
  storage: {
    top: Array<{
      userId: string;
      email: string;
      username: string;
      usedBytes: number;
      quotaBytes: number;
      usagePct: number;
    }>;
    nearQuota: Array<{
      userId: string;
      email: string;
      username: string;
      usedBytes: number;
      quotaBytes: number;
      usagePct: number;
    }>;
  };
  companion: {
    semver: string;
    channel: string;
    platform: string;
    publishedAt: string;
  } | null;
  companionBeta: {
    semver: string;
    channel: string;
    platform: string;
    publishedAt: string;
  } | null;
  health: {
    authApi: { ok: boolean; service: string };
    aiWorkerProxy: {
      ok: boolean;
      skipped?: boolean;
      reason?: string;
      url?: string;
      status?: number;
      error?: string;
      body?: unknown;
      metrics?: {
        enabled: boolean;
        globalQueuedApprox: number;
        keysWithQueued: number;
        ringKeys: number;
        persistedKeysLoaded: number;
        configSource: string | null;
        geminiAsyncJobs: number;
        aiWorkerProxyInFlight: number;
      } | null;
    };
  };
};

export async function fetchAdminDashboard() {
  return requestJson<AdminDashboardPayload>(apiUrl('/api/admin/dashboard'), { cache: 'no-store' });
}
