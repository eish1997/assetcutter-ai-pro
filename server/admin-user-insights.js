import { listAuditLogs, listSessionsForUser } from './auth-store.js';
import { getTrialGeminiUsageForUser } from './trial-gemini-quota-store.js';

export async function getLastLoginForUser(userId) {
  const uid = String(userId || '').trim();
  if (!uid) return null;
  const result = await listAuditLogs({
    action: 'auth.login_success',
    targetUserId: uid,
    limit: 1,
  });
  const row = result.logs?.[0];
  if (!row) return null;
  return {
    at: row.createdAt,
    ip: row.ip || '',
    userAgent: row.userAgent || '',
  };
}

export async function buildAdminUserInsights(userId) {
  const dailyLimit = Number(process.env.TRIAL_GEMINI_DAILY_LIMIT || 60);
  const [lastLogin, sessions, trialGemini] = await Promise.all([
    getLastLoginForUser(userId),
    listSessionsForUser(userId, { limit: 20 }),
    getTrialGeminiUsageForUser(userId, dailyLimit),
  ]);
  return { lastLogin, sessions, trialGemini };
}
