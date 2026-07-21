import { describe, expect, it } from 'vitest';
import { AiPipelineStepError } from '../services/aiPipelineStepError';
import { HttpRequestError } from '../services/httpClient';
import { mapRateLimitErrorText, normalizeApiErrorMessage } from '../services/unifiedAiGateway';

describe('mapRateLimitErrorText', () => {
  it('maps real Google 429 phrases', () => {
    expect(mapRateLimitErrorText('Too Many Requests')).toContain('Google/Vertex');
    expect(mapRateLimitErrorText('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}')).toContain(
      'Google/Vertex'
    );
  });

  it('maps Google depleted prepayment credits separately from RPM rate limits', () => {
    const raw =
      '{"error":{"code":429,"message":"Your prepayment credits are depleted. Please go to AI Studio"}}';
    const mapped = mapRateLimitErrorText(raw);

    expect(mapped).toContain('预付额度');
    expect(mapped).not.toContain('1～3');
  });

  it('maps Volcengine Ark 429 without blaming Google or Vertex', () => {
    const raw =
      'Volcengine Ark rejected AI job handoff: HTTP 429 Your account [2106137965] has reached the set inference limit';
    const mapped = mapRateLimitErrorText(raw);

    expect(mapped).toContain('Ark');
    expect(mapped).toContain('火山方舟');
    expect(mapped).not.toContain('Google/Vertex API');
  });

  it('does not false-positive on reserve UUID containing 429 substring', () => {
    const reserveKey = 'proxy:86337429-70ae-44ae-ac1b-590827fec482';
    expect(mapRateLimitErrorText(`CREDITS_RESERVE_INVALID reserve=${reserveKey}`)).toBeNull();
    expect(mapRateLimitErrorText(`async failed job ${reserveKey}`)).toBeNull();
  });

  it('maps site fairness rate_limited', () => {
    expect(mapRateLimitErrorText('rate_limited')).toContain('公平队列');
  });

  it('does not map pipeline step errors to Google 429', () => {
    expect(mapRateLimitErrorText('[理解步] Too Many Requests')).toBeNull();
    expect(mapRateLimitErrorText('[积分准入] proxy:86337429-70ae-44ae-ac1b-590827fec482')).toBeNull();
  });
  it('keeps AI Gateway paused provider details through generic normalization', () => {
    const err = new HttpRequestError('供应商通道已被运营暂停，请在供应商中心恢复后再试。', 422, 'AI_GATEWAY_PROVIDER_PAUSED', {
      error: 'AI_GATEWAY_PROVIDER_PAUSED',
      message: 'AI provider route is paused by ops control: vertex-site',
      details: { providerIds: ['vertex-site'] },
    });

    expect(normalizeApiErrorMessage(err)).toBe(
      '供应商通道已被运营暂停（vertex-site），请在供应商中心的 Gateway 运营控制中清空暂停供应商，或切换到其他已发布模型。'
    );
  });
});

describe('normalizeApiErrorMessage network termination', () => {
  it('maps terminated image generation failures to an actionable retry hint', () => {
    const msg = normalizeApiErrorMessage(new AiPipelineStepError('image_create', 'NETWORK_TERMINATED', 'terminated'));
    expect(msg).toContain('生图连接中断');
    expect(msg).toContain('参考图');
  });
});

describe('normalizeApiErrorMessage', () => {
  it('prioritizes credits reserve invalid over UUID 429 substring', () => {
    const msg = normalizeApiErrorMessage(
      'CREDITS_RESERVE_INVALID proxy:86337429-70ae-44ae-ac1b-590827fec482'
    );
    expect(msg).toContain('积分预扣');
    expect(msg).not.toContain('上游限流');
    expect(msg).not.toContain('Google/Vertex');
  });

  it('maps real Too Many Requests via normalizeApiErrorMessage', () => {
    expect(normalizeApiErrorMessage('Too Many Requests')).toContain('Google/Vertex');
  });

  it('normalizes Volcengine Ark 429 as provider-specific rate limit', () => {
    const msg = normalizeApiErrorMessage(
      'Volcengine Ark rejected AI job handoff: HTTP 429 Your account [2106137965] has reached the set inference limit'
    );

    expect(msg).toContain('Ark');
    expect(msg).toContain('火山方舟');
    expect(msg).not.toContain('Google/Vertex API');
  });

  it('normalizes Google depleted prepayment credits as account billing issue', () => {
    const msg = normalizeApiErrorMessage(
      '{"error":{"code":429,"message":"Your prepayment credits are depleted. Please go to AI Studio"}}'
    );

    expect(msg).toContain('结算余额');
    expect(msg).not.toContain('RPM 限流');
  });

  it('keeps login-required errors actionable', () => {
    const msg = normalizeApiErrorMessage('{"code":"LOGIN_REQUIRED","error":"请先登录后再使用 AI 生成。"}');
    expect(msg).toContain('请先登录后再使用 AI 生成');
    expect(msg).not.toContain('Google/Vertex');
    expect(msg).not.toContain('积分不足');
  });

  it('preserves AiPipelineStepError message', () => {
    const err = new AiPipelineStepError(
      'credits_gate',
      'CREDITS_RESERVE_INVALID',
      '积分预扣无效'
    );
    expect(normalizeApiErrorMessage(err)).toBe('[积分准入] 积分预扣无效');
    expect(normalizeApiErrorMessage(err)).not.toContain('Google/Vertex');
  });

  it('preserves image_poll step error', () => {
    const err = new AiPipelineStepError('image_poll', 'ASYNC_JOB_FAILED', 'Too Many Requests');
    expect(normalizeApiErrorMessage(err)).toBe('[生图轮询] Too Many Requests');
  });
});
