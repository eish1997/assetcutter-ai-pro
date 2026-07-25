import { describe, expect, it } from 'vitest';

import {
  AI_GATEWAY_BYOK_PATH_AUDIT,
  listPlatformDefaultJobKindsFromAudit,
} from '../shared/aiGatewayByokPathAudit';
import { resolveBillingRoute } from '../shared/billingRoute';

describe('AI Gateway BYOK path audit (B13)', () => {
  it('inventory marks every row as precheckEqualsSettlement and BYOK-only-when-explicit', () => {
    expect(AI_GATEWAY_BYOK_PATH_AUDIT.length).toBeGreaterThanOrEqual(10);
    for (const row of AI_GATEWAY_BYOK_PATH_AUDIT) {
      expect(row.precheckEqualsSettlement).toBe(true);
      expect(row.byokOnlyWhenExplicit).toBe(true);
      expect(row.pathId).toBeTruthy();
      expect(row.entry).toBeTruthy();
    }
  });

  it('platform-default jobKinds stay platform without explicitByok (even with local keys / BYOK channel)', () => {
    const kinds = listPlatformDefaultJobKindsFromAudit();
    expect(kinds).toEqual(
      expect.arrayContaining([
        'workflow_chat',
        'workflow_text_to_image',
        'workflow_jimeng_image',
        'workflow_generate_3d',
      ])
    );
    for (const jobKind of kinds) {
      expect(
        resolveBillingRoute({
          jobKind,
          hasUserApiKey: true,
          hasTripoApiKey: true,
          hasTencentCreds: true,
          channel: 'openai-official',
          generate3dProvider: 'tripo',
        }).routeKind
      ).toBe('platform');
    }
  });

  it('BYOK only when explicitByok for 3D and channel tools', () => {
    expect(
      resolveBillingRoute({
        jobKind: 'workflow_generate_3d',
        generate3dProvider: 'tripo',
        hasTripoApiKey: true,
        explicitByok: true,
      }).routeKind
    ).toBe('byok');
    expect(
      resolveBillingRoute({
        jobKind: 'workflow_chat',
        channel: 'openai-official',
        explicitByok: true,
      }).routeKind
    ).toBe('byok');
    expect(
      resolveBillingRoute({
        jobKind: 'workflow_chat',
        channel: 'openai-official',
        explicitByok: false,
      }).routeKind
    ).toBe('platform');
  });
});
