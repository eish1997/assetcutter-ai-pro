type AuditMeta = Record<string, unknown> | unknown[] | null;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function fmtQuota(bytes: unknown): string {
  const n = Number(bytes);
  if (!Number.isFinite(n)) return String(bytes ?? '—');
  return `${Math.round(n / (1024 * 1024))} MB`;
}

function diffObjectFields(before: Record<string, unknown>, after: Record<string, unknown>, labels: Record<string, string>) {
  const parts: string[] = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const b = before[key];
    const a = after[key];
    if (JSON.stringify(b) === JSON.stringify(a)) continue;
    const label = labels[key] || key;
    if (key === 'workspaceQuotaBytes') {
      parts.push(`${label} ${fmtQuota(b)}→${fmtQuota(a)}`);
    } else {
      parts.push(`${label} ${String(b ?? '—')}→${String(a ?? '—')}`);
    }
  }
  return parts;
}

function summarizePermissionDiff(before: unknown, after: unknown) {
  const b = Array.isArray(before) ? before.map(String).sort() : [];
  const a = Array.isArray(after) ? after.map(String).sort() : [];
  const added = a.filter((x) => !b.includes(x)).length;
  const removed = b.filter((x) => !a.includes(x)).length;
  if (!added && !removed) return '权限无变化';
  const bits: string[] = [];
  if (added) bits.push(`+${added}`);
  if (removed) bits.push(`-${removed}`);
  return `权限 ${bits.join(' / ')}`;
}

function summarizeConfigDiff(before: unknown, after: unknown) {
  const b = asRecord(before) || {};
  const a = asRecord(after) || {};
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const changed: string[] = [];
  for (const k of keys) {
    if (JSON.stringify(b[k]) !== JSON.stringify(a[k])) changed.push(k);
  }
  if (!changed.length) return '配置无变化';
  if (changed.length <= 2) {
    return changed.map((k) => `${k} ${String(b[k] ?? '—')}→${String(a[k] ?? '—')}`).join('；');
  }
  return `变更 ${changed.length} 项：${changed.slice(0, 2).join('、')}…`;
}

export function auditLogSummary(input: {
  action: string;
  actorIdentifier?: string;
  targetUserId?: string | null;
  meta?: AuditMeta;
}): string {
  const actor = String(input.actorIdentifier || '').trim() || '（未知）';
  const meta = input.meta;
  const m = asRecord(meta);
  const action = input.action;

  if (action === 'auth.login_failed') {
    return `${actor} 登录失败`;
  }
  if (action === 'auth.login_success' || action === 'auth.login') {
    return `${actor} 登录成功`;
  }
  if (action === 'auth.logout') {
    return actor !== '（未知）' ? `${actor} 登出` : '登出';
  }
  if (action === 'auth.register') {
    return `${actor} 注册账号`;
  }

  if (action === 'admin.user_update' && m?.before && m?.after) {
    const parts = diffObjectFields(asRecord(m.before) || {}, asRecord(m.after) || {}, {
      role: '角色',
      status: '状态',
      staffRoleId: '后台角色',
      workspaceQuotaBytes: '云配额',
    });
    const target = input.targetUserId ? `用户 ${input.targetUserId.slice(0, 8)}…` : '用户';
    return parts.length ? `${actor} 变更${target}：${parts.join('；')}` : `${actor} 更新${target}`;
  }

  if (action === 'admin.role_permissions_update' && m) {
    const role = m.roleId ? `角色 ${String(m.roleId).slice(0, 8)}…` : '角色';
    return `${actor} 更新${role}：${summarizePermissionDiff(m.before, m.after)}`;
  }

  if (action === 'admin.role_create' && m) {
    return `${actor} 创建角色 ${String(m.slug || m.roleId || '')}`;
  }
  if (action === 'admin.role_delete' && m) {
    return `${actor} 删除角色 ${String(m.roleId || '').slice(0, 8)}…`;
  }

  if (action === 'admin.gemini_fairness_config_put' && m) {
    return `${actor} 保存 Gemini 限流：${summarizeConfigDiff(m.before, m.after)}`;
  }
  if (action === 'admin.gemini_fairness_config_delete') {
    return `${actor} 清空 Gemini 限流覆盖`;
  }

  if (action === 'admin.companion_artifact_register' && m) {
    return `${actor} 登记伴侣 ${String(m.kind || '')} ${String(m.semver || '')}`.trim();
  }
  if (action === 'admin.companion_artifact_delete' && m) {
    return `${actor} 删除伴侣发行 ${String(m.id || '').slice(0, 8)}…`;
  }
  if (action === 'admin.companion_artifact_presign_put') {
    return `${actor} 伴侣预签名上传`;
  }
  if (action === 'companion_artifact_download' && m) {
    return `${actor} 下载伴侣 ${String(m.kind || '')} ${String(m.semver || '')}`.trim();
  }

  if (action === 'admin.workspace_usage_reconcile' && m) {
    const mb = fmtQuota(m.usedBytes);
    return `${actor} 同步用量 → ${mb}${m.forceEmptyReset ? '（强制）' : ''}`;
  }

  if (action === 'admin.capability_preset_publish' && m) {
    return `${actor} 发布能力预设 ${String(m.presetId || '')}`;
  }

  return actor !== '（未知）' ? `${actor} · ${action}` : action;
}
