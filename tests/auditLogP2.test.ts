import { describe, expect, it } from 'vitest';
import { encodeAuditCursor, decodeAuditCursor, rowBeforeCursor } from '../server/admin-audit-cursor.js';
import { redactAuditLogRow } from '../server/admin-audit-redact.js';
import { getAuditLogRetentionMeta } from '../server/admin-audit-retention.js';
import { DEFAULT_ROLE_PERMISSIONS, AUDITOR_ROLE_SLUG } from '../server/admin-permissions.js';

describe('audit P2 cursor', () => {
  it('encodes and decodes cursor', () => {
    const row = { id: 'abc-123', createdAt: '2026-06-05T10:00:00.000Z' };
    const enc = encodeAuditCursor(row);
    expect(enc).toBeTruthy();
    expect(decodeAuditCursor(enc)).toEqual({ createdAt: row.createdAt, id: row.id });
  });

  it('rowBeforeCursor compares createdAt then id', () => {
    const cursor = { id: 'b', createdAt: '2026-06-05T10:00:00.000Z' };
    expect(rowBeforeCursor({ id: 'a', createdAt: '2026-06-05T09:00:00.000Z' }, cursor)).toBe(true);
    expect(rowBeforeCursor({ id: 'a', createdAt: '2026-06-05T10:00:00.000Z' }, cursor)).toBe(true);
    expect(rowBeforeCursor({ id: 'c', createdAt: '2026-06-05T10:00:00.000Z' }, cursor)).toBe(false);
  });
});

describe('audit P2 redact', () => {
  it('masks ip and sensitive meta', () => {
    const out = redactAuditLogRow({
      ip: '192.168.1.42',
      userAgent: 'Mozilla/5.0',
      targetUserId: 'user-uuid-long-value',
      meta: { r2Key: 'secret/key', presetId: 'preset-abc-123456' },
    });
    expect(out.ip).toBe('192.168.1.xxx');
    expect(out.userAgent).toBe('[redacted]');
    expect(out.targetUserId).toContain('…');
    expect(out.meta.r2Key).toBe('[redacted]');
  });
});

describe('auditor role seed', () => {
  it('auditor has read-only permissions', () => {
    const perms = DEFAULT_ROLE_PERMISSIONS[AUDITOR_ROLE_SLUG];
    expect(perms).toContain('audit.read');
    expect(perms).toContain('users.read');
    expect(perms).not.toContain('users.write');
    expect(perms).not.toContain('dashboard.read');
  });

  it('retention meta returns note', () => {
    const meta = getAuditLogRetentionMeta();
    expect(meta.storage).toMatch(/postgres|json/);
    expect(meta.note).toBeTruthy();
  });
});
