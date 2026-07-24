/**
 * A5: publish diagnosis gate + dispatchPolicy rollback helpers for ops rollout.
 */

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

export const DEFAULT_PUBLISH_DIAGNOSIS_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function normalizePublishDiagnosisSnapshot(raw) {
  const row = asRecord(raw);
  if (!row) return null;
  const auditedAt = nonEmptyString(row.auditedAt) || nonEmptyString(row.testedAt) || nonEmptyString(row.generatedAt);
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

export function normalizePublishDiagnosisByModel(raw) {
  const input = asRecord(raw);
  if (!input) return null;
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    const id = nonEmptyString(key);
    const snap = normalizePublishDiagnosisSnapshot(value);
    if (!id || !snap) continue;
    out[id] = snap;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Gate publish allowlist against recent diagnosis snapshots.
 * @returns {{ ok: boolean, forceRequired: boolean, issues: Array<object> }}
 */
export function evaluatePublishDiagnosisGate(options = {}) {
  const selectedIds = Array.isArray(options.selectedIds)
    ? options.selectedIds.map((id) => nonEmptyString(id)).filter(Boolean)
    : [];
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
  const targets = onlyNew && previousSet
    ? selectedIds.filter((id) => !previousSet.has(id))
    : selectedIds;

  const issues = [];
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

export function normalizeRolloutControl(raw) {
  const input = asRecord(raw) || {};
  const previous = asRecord(input.previousDispatchPolicy);
  return {
    previousDispatchPolicy: previous,
    diagnosisMaxAgeMs: Math.max(
      60_000,
      Number(input.diagnosisMaxAgeMs || DEFAULT_PUBLISH_DIAGNOSIS_MAX_AGE_MS) || DEFAULT_PUBLISH_DIAGNOSIS_MAX_AGE_MS
    ),
  };
}

export function withDispatchPolicyRollbackSnapshot(currentConfig, nextDispatchPolicy) {
  const current = asRecord(currentConfig) || {};
  const rollout = normalizeRolloutControl(current.rollout);
  const previous = asRecord(current.dispatchPolicy);
  return {
    ...current,
    dispatchPolicy: nextDispatchPolicy,
    rollout: {
      ...rollout,
      previousDispatchPolicy: previous,
    },
  };
}

export function restorePreviousDispatchPolicy(currentConfig) {
  const current = asRecord(currentConfig) || {};
  const rollout = normalizeRolloutControl(current.rollout);
  if (!rollout.previousDispatchPolicy) {
    return { config: current, restored: false, reason: 'no_previous_dispatch_policy' };
  }
  return {
    config: {
      ...current,
      dispatchPolicy: rollout.previousDispatchPolicy,
      rollout: {
        ...rollout,
        previousDispatchPolicy: asRecord(current.dispatchPolicy),
      },
    },
    restored: true,
    reason: null,
  };
}
