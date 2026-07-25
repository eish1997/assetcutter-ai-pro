import { describe, expect, it } from 'vitest';

import {
  classifySmokePrereq,
  exitCodeForStatus,
} from '../scripts/ai-gateway-302-staging-smoke.mjs';

describe('AI Gateway 302 staging smoke gate (B15)', () => {
  it('blocks when admin credentials or provider key missing', () => {
    expect(classifySmokePrereq({ identifier: '', password: 'x', hasProviderKey: true })).toEqual({
      status: 'blocked',
      reason: 'missing_admin_credentials',
    });
    expect(
      classifySmokePrereq({ identifier: 'admin', password: 'x', hasProviderKey: false })
    ).toEqual({
      status: 'blocked',
      reason: 'missing_302_provider_key',
    });
    expect(
      classifySmokePrereq({ identifier: 'admin', password: 'x', hasProviderKey: true })
    ).toEqual({ status: 'ready', reason: 'ok' });
  });

  it('maps blocked to exit 2 unless optional skip', () => {
    expect(exitCodeForStatus('ok')).toBe(0);
    expect(exitCodeForStatus('blocked')).toBe(2);
    expect(exitCodeForStatus('blocked', { optional: true })).toBe(0);
    expect(exitCodeForStatus('blocked', { optional: true, reportBlocked: true })).toBe(2);
    expect(exitCodeForStatus('failed')).toBe(1);
  });
});
