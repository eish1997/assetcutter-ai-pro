import { describe, expect, it } from 'vitest';
import { parseExcludeActions } from '../server/admin-audit-category.js';
import { auditActionSeverity, loginSuccessExcludeParam } from '../services/auditActionSeverity';

describe('audit P1 helpers', () => {
  it('parseExcludeActions splits comma list', () => {
    expect(parseExcludeActions('auth.login_success,auth.login')).toEqual([
      'auth.login_success',
      'auth.login',
    ]);
    expect(parseExcludeActions('')).toEqual([]);
  });

  it('auditActionSeverity classifies dangerous actions', () => {
    expect(auditActionSeverity('admin.role_delete')).toBe('danger');
    expect(auditActionSeverity('admin.user_update')).toBe('warn');
    expect(auditActionSeverity('auth.login_success')).toBe('neutral');
  });

  it('loginSuccessExcludeParam includes legacy key', () => {
    expect(loginSuccessExcludeParam()).toContain('auth.login_success');
    expect(loginSuccessExcludeParam()).toContain('auth.login');
  });
});
