import { describe, expect, it } from 'vitest';
import { auditLogMatchesCategory } from '../services/auditLogCategory';
import { auditLogSummary } from '../services/auditLogSummary';
import { resolveAuditTimeRange } from '../services/auditLogTimeRange';

describe('auditLogSummary', () => {
  it('summarizes user update diff', () => {
    const s = auditLogSummary({
      action: 'admin.user_update',
      actorIdentifier: 'maoer',
      targetUserId: 'user-abc-12345678',
      meta: {
        before: { status: 'active', role: 'user' },
        after: { status: 'disabled', role: 'user' },
      },
    });
    expect(s).toContain('maoer');
    expect(s).toContain('状态');
    expect(s).toContain('active→disabled');
  });

  it('labels login success', () => {
    expect(auditLogSummary({ action: 'auth.login_success', actorIdentifier: 'foo' })).toBe('foo 登录成功');
  });
});

describe('auditLogCategory', () => {
  it('maps admin vs release actions', () => {
    expect(auditLogMatchesCategory('admin.user_update', 'admin')).toBe(true);
    expect(auditLogMatchesCategory('admin.gemini_fairness_config_put', 'admin')).toBe(false);
    expect(auditLogMatchesCategory('admin.gemini_fairness_config_put', 'release')).toBe(true);
    expect(auditLogMatchesCategory('auth.login_success', 'auth')).toBe(true);
  });
});

describe('auditLogTimeRange', () => {
  it('defaults 7d range with from before to', () => {
    const { from, to } = resolveAuditTimeRange('7d', '', '');
    expect(from).toBeTruthy();
    expect(to).toBeTruthy();
    expect(new Date(from).getTime()).toBeLessThan(new Date(to).getTime());
  });
});
