import { describe, expect, it } from 'vitest';

import {
  attachFailureReasonToErrorBody,
  decorateErrorWithFailureReason,
  gatewayFailureMetadata,
  publicAiGatewayFailureReason,
  resolveAiGatewayFailureReason,
} from '../server/ai-gateway/failure-reason.js';
import { mapAuthAiGatewayError } from '../server/ai-gateway/auth-api-handler.js';
import { AiGatewayValidationError } from '../server/ai-gateway/job.js';
import { AiGatewayRouteError } from '../server/ai-gateway/provider-router.js';

describe('AI Gateway failure reason', () => {
  it('maps credits exceeded to billing/user', () => {
    const reason = resolveAiGatewayFailureReason({
      code: 'CREDITS_EXCEEDED',
      message: '积分不足，请联系管理员补充额度',
    });
    expect(reason).toMatchObject({
      code: 'CREDITS_EXCEEDED',
      stage: 'billing',
      owner: 'user',
      retryable: false,
    });
  });

  it('maps unpublished model to publication/admin', () => {
    expect(
      resolveAiGatewayFailureReason(
        new AiGatewayValidationError('Model not published', 'AI_GATEWAY_MODEL_NOT_PUBLISHED')
      )
    ).toMatchObject({
      code: 'AI_GATEWAY_MODEL_NOT_PUBLISHED',
      stage: 'publication',
      owner: 'admin',
    });
  });

  it('maps route not found / paused / key unavailable / adapter pending', () => {
    expect(resolveAiGatewayFailureReason('AI_GATEWAY_MODEL_ROUTE_NOT_FOUND')).toMatchObject({
      stage: 'routing',
      owner: 'developer',
    });
    expect(resolveAiGatewayFailureReason('AI_GATEWAY_PROVIDER_PAUSED')).toMatchObject({
      stage: 'routing',
      owner: 'admin',
      retryable: true,
    });
    expect(resolveAiGatewayFailureReason('AI_GATEWAY_PROVIDER_KEY_UNAVAILABLE')).toMatchObject({
      stage: 'provider_key',
      owner: 'admin',
    });
    expect(resolveAiGatewayFailureReason('AI_GATEWAY_MODEL_ADAPTER_PENDING')).toMatchObject({
      stage: 'adapter',
      owner: 'developer',
    });
  });

  it('maps upstream 429 and 5xx', () => {
    expect(resolveAiGatewayFailureReason({ message: 'HTTP 429 Too Many Requests', status: 429 })).toMatchObject({
      code: 'AI_GATEWAY_UPSTREAM_RATE_LIMITED',
      stage: 'upstream',
      owner: 'upstream',
      retryable: true,
    });
    expect(resolveAiGatewayFailureReason({ message: 'upstream connect error', status: 503 })).toMatchObject({
      code: 'AI_GATEWAY_UPSTREAM_UNAVAILABLE',
      stage: 'upstream',
      owner: 'upstream',
      retryable: true,
    });
  });

  it('maps empty artifact failures', () => {
    expect(
      resolveAiGatewayFailureReason({ message: 'AI Gateway image job succeeded without image output' })
    ).toMatchObject({
      code: 'AI_GATEWAY_ARTIFACT_EMPTY',
      stage: 'artifact',
      owner: 'upstream',
    });
  });

  it('decorates adapter HTTP errors with failureReason before throw boundary', () => {
    const err = new Error('OpenAI rejected AI job handoff: HTTP 429 Too Many Requests');
    (err as { status?: number }).status = 429;
    const decorated = decorateErrorWithFailureReason(err, { providerId: 'openai-official', adapterId: 'openai-official' });
    expect(decorated.failureReason).toMatchObject({
      code: 'AI_GATEWAY_UPSTREAM_RATE_LIMITED',
      stage: 'upstream',
      owner: 'upstream',
      retryable: true,
    });
    expect(gatewayFailureMetadata(decorated).gatewayFailure.stage).toBe('upstream');
  });

  it('attaches failureReason onto HTTP error bodies', () => {
    const mapped = mapAuthAiGatewayError(
      new AiGatewayValidationError('No usable platform key', 'AI_GATEWAY_PROVIDER_KEY_UNAVAILABLE')
    );
    expect(mapped.status).toBe(422);
    expect(mapped.body).toMatchObject({
      error: 'AI_GATEWAY_PROVIDER_KEY_UNAVAILABLE',
      failureReason: {
        code: 'AI_GATEWAY_PROVIDER_KEY_UNAVAILABLE',
        stage: 'provider_key',
        owner: 'admin',
      },
    });

    const routeMapped = mapAuthAiGatewayError(new AiGatewayRouteError('No AI provider route'));
    expect(routeMapped.body.failureReason).toMatchObject({
      stage: 'routing',
      code: 'AI_GATEWAY_NO_PROVIDER_ROUTE',
    });

    const attached = attachFailureReasonToErrorBody(
      { error: 'AI_GATEWAY_MODEL_ROUTE_NOT_FOUND', message: 'missing' },
      'AI_GATEWAY_MODEL_ROUTE_NOT_FOUND'
    );
    expect(publicAiGatewayFailureReason(attached.failureReason)?.stage).toBe('routing');
  });

  it('builds gatewayFailure metadata for failed jobs', () => {
    const meta = gatewayFailureMetadata(
      { code: 'AI_GATEWAY_EXECUTION_HANDOFF_FAILED', message: 'HTTP 429' },
      { providerId: 'openai-official', adapterId: 'openai-official', workerId: 'image-worker' }
    );
    expect(meta.gatewayFailure).toMatchObject({
      code: 'AI_GATEWAY_UPSTREAM_RATE_LIMITED',
      stage: 'upstream',
      providerId: 'openai-official',
      adapterId: 'openai-official',
      workerId: 'image-worker',
    });
    expect(meta.gatewayFailure.at).toBeTruthy();
  });
});
