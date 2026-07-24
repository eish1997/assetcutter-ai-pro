/** A5 client helpers mirroring server/ai-gateway/rollout-control.js publish gate. */

export type PublishDiagnosisSnapshot = {
  ok: boolean;
  status: string;
  auditedAt: string;
  message?: string | null;
  source?: string | null;
  code?: string | null;
};

export type PublishDiagnosisGateIssue = {
  canonicalModelId: string;
  code: 'PUBLISH_DIAGNOSIS_MISSING' | 'PUBLISH_DIAGNOSIS_FAILED' | 'PUBLISH_DIAGNOSIS_STALE' | string;
  message: string;
  status?: string;
  auditedAt?: string;
};

export const DEFAULT_PUBLISH_DIAGNOSIS_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function nonEmptyString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function normalizePublishDiagnosisSnapshot(raw: unknown): PublishDiagnosisSnapshot | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const auditedAt =
    nonEmptyString(row.auditedAt) || nonEmptyString(row.testedAt) || nonEmptyString(row.generatedAt);
  if (!auditedAt) return null;
  return {
    ok: row.ok === true || row.status === 'ready' || row.status === 'passed',
    status: nonEmptyString(row.status) || (row.ok === true ? 'ready' : 'blocked'),
    auditedAt,
    message: nonEmptyString(row.message) || null,
    source: nonEmptyString(row.source) || 'screen',
    code: nonEmptyString(row.code) || null,
  };
}

export function normalizePublishDiagnosisByModel(
  raw: unknown
): Record<string, PublishDiagnosisSnapshot> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, PublishDiagnosisSnapshot> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const id = nonEmptyString(key);
    const snap = normalizePublishDiagnosisSnapshot(value);
    if (!id || !snap) continue;
    out[id] = snap;
  }
  return Object.keys(out).length ? out : null;
}

export function evaluatePublishDiagnosisGate(options: {
  selectedIds: string[];
  previousAllowlist?: string[] | null;
  snapshots?: Record<string, unknown> | null;
  maxAgeMs?: number;
  nowMs?: number;
  force?: boolean;
  onlyNewlyAdded?: boolean;
}): {
  ok: boolean;
  forceRequired: boolean;
  issues: PublishDiagnosisGateIssue[];
  checkedIds: string[];
  maxAgeMs: number;
} {
  const selectedIds = (options.selectedIds || []).map((id) => nonEmptyString(id)).filter(Boolean);
  const previousAllowlist = Array.isArray(options.previousAllowlist)
    ? options.previousAllowlist.map((id) => nonEmptyString(id)).filter(Boolean)
    : null;
  const snapshots = normalizePublishDiagnosisByModel(options.snapshots) || {};
  const maxAgeMs = Math.max(
    60_000,
    Number(options.maxAgeMs || DEFAULT_PUBLISH_DIAGNOSIS_MAX_AGE_MS) || DEFAULT_PUBLISH_DIAGNOSIS_MAX_AGE_MS
  );
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const force = options.force === true;
  const onlyNew = options.onlyNewlyAdded !== false;
  const previousSet = previousAllowlist ? new Set(previousAllowlist) : null;
  const targets =
    onlyNew && previousSet ? selectedIds.filter((id) => !previousSet.has(id)) : selectedIds;

  const issues: PublishDiagnosisGateIssue[] = [];
  for (const id of targets) {
    const snap = snapshots[id];
    if (!snap) {
      issues.push({
        canonicalModelId: id,
        code: 'PUBLISH_DIAGNOSIS_MISSING',
        message: '缺少最近一屏诊断，请先跑诊断再发布',
      });
      continue;
    }
    if (!snap.ok) {
      issues.push({
        canonicalModelId: id,
        code: 'PUBLISH_DIAGNOSIS_FAILED',
        message: snap.message || '最近诊断未通过',
        status: snap.status,
        auditedAt: snap.auditedAt,
      });
      continue;
    }
    const auditedMs = Date.parse(snap.auditedAt);
    if (!Number.isFinite(auditedMs) || nowMs - auditedMs > maxAgeMs) {
      issues.push({
        canonicalModelId: id,
        code: 'PUBLISH_DIAGNOSIS_STALE',
        message: `诊断已过期（>${Math.round(maxAgeMs / 3_600_000)}h），请重跑一屏诊断`,
        auditedAt: snap.auditedAt,
      });
    }
  }

  return {
    ok: force || issues.length === 0,
    forceRequired: issues.length > 0,
    issues,
    checkedIds: targets,
    maxAgeMs,
  };
}

export function formatPublishDiagnosisGateMessage(issues: PublishDiagnosisGateIssue[]): string {
  if (!issues.length) return '';
  const head = issues
    .slice(0, 4)
    .map((row) => `${row.canonicalModelId}（${row.message}）`)
    .join('；');
  const more = issues.length > 4 ? '；...' : '';
  return `发布前诊断门禁：${head}${more}。可重跑一屏诊断，或确认后强制发布。`;
}
