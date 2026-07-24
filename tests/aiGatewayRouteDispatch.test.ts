import { describe, expect, it } from 'vitest';

import {
  scoreDispatchCandidate,
  selectRouteWithDispatchPolicy,
} from '../server/ai-gateway/route-dispatch.js';
import { resolveAiGatewayRouteDecision } from '../server/ai-gateway/route-decision.js';

describe('AI Gateway route dispatch (Slice 6)', () => {
  it('ranks healthier cheaper routes above degraded expensive ones', () => {
    const scoredHealthy = scoreDispatchCandidate(
      { providerId: 'openai-official', priority: 30 },
      {
        keys: [{ provider: 'openai-official', enabled: true, runtime: { healthStatus: 'healthy' } }],
      },
      { costHints: { 'openai-official': 20, tinysnow: 80 } }
    );
    const scoredDegraded = scoreDispatchCandidate(
      { providerId: 'tinysnow', priority: 20 },
      {
        keys: [{ provider: 'tinysnow', enabled: true, runtime: { healthStatus: 'degraded' } }],
      },
      { costHints: { 'openai-official': 20, tinysnow: 80 } }
    );
    expect(scoredHealthy.total).toBeGreaterThan(scoredDegraded.total);
  });

  it('honors admin provider pin with rollback note', () => {
    const { selected, selectionReason } = selectRouteWithDispatchPolicy(
      [
        { providerId: 'openai-official', priority: 10 },
        { providerId: '302ai', priority: 40 },
      ],
      {
        canonicalModelId: 'gpt-image-2',
        modality: 'image',
        keys: [
          { provider: 'openai-official', enabled: true, hasSecret: true, runtime: { healthStatus: 'healthy' } },
          { provider: '302ai', enabled: true, hasSecret: true, runtime: { healthStatus: 'healthy' } },
        ],
      },
      {
        providerPins: [
          {
            canonicalModelId: 'gpt-image-2',
            modality: 'image',
            providerId: '302ai',
            reason: 'manual pin for incident',
          },
        ],
      }
    );
    expect(selected.providerId).toBe('302ai');
    expect(selectionReason).toMatchObject({
      strategy: 'admin_pin',
      code: 'AI_GATEWAY_DISPATCH_ADMIN_PIN',
      override: {
        kind: 'provider_pin',
        providerId: '302ai',
        rollback: expect.stringContaining('providerPins'),
      },
    });
    expect(selectionReason.scores.length).toBe(2);
  });

  it('attaches selectionReason on resolveAiGatewayRouteDecision selectedRoute', async () => {
    const decision = await resolveAiGatewayRouteDecision(
      {
        canonicalModelId: 'gpt-image-2',
        modality: 'image',
      },
      {
        listProviderKeys: async () => [
          { provider: 'openai-official', enabled: true, hasSecret: true, runtime: { healthStatus: 'healthy' } },
          { provider: '302ai', enabled: true, hasSecret: true, runtime: { healthStatus: 'warning' } },
        ],
        dispatchPolicy: {
          costHints: { 'openai-official': 10, '302ai': 90 },
        },
      }
    );
    expect(decision.ok).toBe(true);
    expect(decision.selectedRoute?.selectionReason?.code).toMatch(/AI_GATEWAY_DISPATCH_/);
    expect(decision.selectedRoute?.selectionReason?.auditedAt).toBeTruthy();
    expect(Array.isArray(decision.selectedRoute?.selectionReason?.scores)).toBe(true);
  });

  it('admin pin on decision overrides automatic ranking', async () => {
    const decision = await resolveAiGatewayRouteDecision(
      {
        canonicalModelId: 'gpt-image-2',
        modality: 'image',
      },
      {
        listProviderKeys: async () => [
          { provider: 'openai-official', enabled: true, hasSecret: true, runtime: { healthStatus: 'healthy' } },
          { provider: 'tinysnow', enabled: true, hasSecret: true, runtime: { healthStatus: 'healthy' } },
        ],
        dispatchPolicy: {
          providerPins: [
            {
              canonicalModelId: 'gpt-image-2',
              modality: 'image',
              providerId: 'tinysnow',
              reason: 'ops pin',
            },
          ],
        },
      }
    );
    expect(decision.selectedRoute?.providerId).toBe('tinysnow');
    expect(decision.selectedRoute?.selectionReason).toMatchObject({
      strategy: 'admin_pin',
      code: 'AI_GATEWAY_DISPATCH_ADMIN_PIN',
    });
  });
});
