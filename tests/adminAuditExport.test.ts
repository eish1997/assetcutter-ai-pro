import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../server/auth-store.js', () => ({
  listAuditLogs: vi.fn(),
}));

import { listAuditLogs } from '../server/auth-store.js';
import { buildAuditLogsCsv, parseAdminAuditQuery } from '../server/admin-audit-export.js';

describe('admin-audit-export', () => {
  beforeEach(() => {
    vi.mocked(listAuditLogs).mockReset();
  });

  it('parseAdminAuditQuery maps search params', () => {
    const u = new URL('http://local?limit=10&offset=5&action=auth.login&actor=foo');
    const q = parseAdminAuditQuery(u.searchParams);
    expect(q).toEqual({
      limit: '10',
      offset: '5',
      action: 'auth.login',
      actor: 'foo',
      targetUserId: '',
      from: '',
      to: '',
      category: '',
      excludeActions: '',
      cursor: '',
    });
  });

  it('buildAuditLogsCsv emits BOM and labeled header row', async () => {
    vi.mocked(listAuditLogs).mockResolvedValue({
      logs: [
        {
          id: '1',
          createdAt: '2026-06-05T00:00:00.000Z',
          actorIdentifier: 'admin@test',
          action: 'auth.login',
          targetUserId: null,
          ip: '127.0.0.1',
          meta: { ok: true },
        },
      ],
      total: 1,
      limit: 5000,
      offset: 0,
    });
    const { csv, rowCount, truncated } = await buildAuditLogsCsv({ action: '' });
    expect(rowCount).toBe(1);
    expect(truncated).toBe(false);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('createdAt,actorIdentifier,action,actionLabel');
    expect(csv).toContain('登录成功');
    expect(csv).toContain('127.0.0.1');
  });
});
