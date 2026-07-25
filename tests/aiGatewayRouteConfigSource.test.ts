import { describe, expect, it } from 'vitest';

import {
  gatewayRouteConfigKey,
  isGatewayRouteConfigDisabled,
  listGatewayRouteConfigs,
  materializeGatewayRouteConfigRow,
  resolveGatewayRouteConfig,
} from '../server/ai-gateway/route-config-source.js';

describe('AI Gateway route-config-source (B11)', () => {
  it('materializes overlay rows with defaults', () => {
    expect(
      materializeGatewayRouteConfigRow({
        canonicalModelId: 'fixture-model',
        providerId: '302ai',
        modality: 'image',
        priority: 7.8,
        upstreamModelId: 'upstream-v1',
        enabled: false,
      })
    ).toMatchObject({
      canonicalModelId: 'fixture-model',
      providerId: '302ai',
      modality: 'image',
      priority: 7,
      upstreamModelId: 'upstream-v1',
      enabled: false,
      gatewayExecutionStatus: 'ready',
      source: 'gateway_route_config',
    });
    expect(materializeGatewayRouteConfigRow({ providerId: '302ai' })).toBeNull();
    expect(gatewayRouteConfigKey('m', '302ai', 'image')).toBe('m:302ai:image');
  });

  it('seed-only: returns executable seed routes when no gatewayRouteConfigs match', () => {
    const routes = listGatewayRouteConfigs(
      { canonicalModelId: 'gpt-image-2', modality: 'image' },
      { gatewayRouteConfigs: [] }
    );
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.every((row) => row.source === 'seed_executable_rules')).toBe(true);
    expect(routes.every((row) => row.enabled === true)).toBe(true);
    expect(routes.some((row) => row.providerId === 'openai-official')).toBe(true);
  });

  it('overlay: covers priority / enabled / upstreamModelId on matching seed route', () => {
    const routes = listGatewayRouteConfigs(
      { canonicalModelId: 'gpt-image-2', modality: 'image' },
      {
        gatewayRouteConfigs: [
          {
            canonicalModelId: 'gpt-image-2',
            providerId: 'openai-official',
            modality: 'image',
            enabled: false,
            priority: 1,
            upstreamModelId: 'gpt-image-2-override',
          },
        ],
      }
    );
    const overlay = routes.find((row) => row.providerId === 'openai-official');
    expect(overlay).toMatchObject({
      enabled: false,
      priority: 1,
      upstreamModelId: 'gpt-image-2-override',
      source: 'seed_with_gateway_route_overlay',
    });
    expect(isGatewayRouteConfigDisabled(overlay)).toBe(true);
  });

  it('append: gatewayRouteConfigs without seed become candidates', () => {
    const routes = listGatewayRouteConfigs(
      { canonicalModelId: 'fixture-aggregator-model-b11', modality: 'image' },
      {
        gatewayRouteConfigs: [
          {
            canonicalModelId: 'fixture-aggregator-model-b11',
            providerId: '302ai',
            modality: 'image',
            enabled: true,
            priority: 3,
            upstreamModelId: 'upstream-image-b11',
          },
        ],
      }
    );
    expect(routes).toEqual([
      expect.objectContaining({
        canonicalModelId: 'fixture-aggregator-model-b11',
        providerId: '302ai',
        upstreamModelId: 'upstream-image-b11',
        priority: 3,
        source: 'gateway_route_config',
        enabled: true,
      }),
    ]);
    expect(
      resolveGatewayRouteConfig(
        { canonicalModelId: 'fixture-aggregator-model-b11', modality: 'image' },
        {
          gatewayRouteConfigs: [
            {
              canonicalModelId: 'fixture-aggregator-model-b11',
              providerId: '302ai',
              modality: 'image',
              priority: 3,
            },
          ],
        }
      )?.providerId
    ).toBe('302ai');
  });

  it('disabledProviders: drops matching overlay providers', () => {
    const routes = listGatewayRouteConfigs(
      {
        canonicalModelId: 'fixture-aggregator-model-b11',
        modality: 'image',
        disabledProviders: ['302ai'],
      },
      {
        gatewayRouteConfigs: [
          {
            canonicalModelId: 'fixture-aggregator-model-b11',
            providerId: '302ai',
            modality: 'image',
            enabled: true,
            priority: 3,
          },
          {
            canonicalModelId: 'fixture-aggregator-model-b11',
            providerId: 'aihubmix',
            modality: 'image',
            enabled: true,
            priority: 5,
          },
        ],
      }
    );
    expect(routes.map((row) => row.providerId)).toEqual(['aihubmix']);
  });
});
