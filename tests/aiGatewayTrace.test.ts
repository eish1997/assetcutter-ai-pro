import { afterEach, describe, expect, it } from 'vitest';
import {
  buildAiGatewayImageJobTraceBody,
  extractAiGatewayTraceJobId,
  isAiGatewayJobTraceEnabled,
} from '../services/aiGatewayTrace';

describe('aiGatewayTrace', () => {
  const prev = process.env.VITE_AI_GATEWAY_JOB_TRACE;

  afterEach(() => {
    if (prev === undefined) delete process.env.VITE_AI_GATEWAY_JOB_TRACE;
    else process.env.VITE_AI_GATEWAY_JOB_TRACE = prev;
  });

  it('defaults to tracing Vertex image jobs only', () => {
    process.env.VITE_AI_GATEWAY_JOB_TRACE = '';
    expect(isAiGatewayJobTraceEnabled(true)).toBe(true);
    expect(isAiGatewayJobTraceEnabled(false)).toBe(false);

    process.env.VITE_AI_GATEWAY_JOB_TRACE = 'false';
    expect(isAiGatewayJobTraceEnabled(true)).toBe(false);

    process.env.VITE_AI_GATEWAY_JOB_TRACE = 'true';
    expect(isAiGatewayJobTraceEnabled(false)).toBe(true);
  });

  it('builds a trace-only image job body for the server AI gateway', () => {
    const body = buildAiGatewayImageJobTraceBody({
      model: 'gemini-3.1-flash-image',
      contents: [{ role: 'user', parts: [{ text: 'draw a cup' }] }],
      config: { responseModalities: ['IMAGE'] },
      registryId: 'gemini-3.1-flash-image',
      estimatedCredits: 50,
      useVertex: true,
    });

    expect(body).toMatchObject({
      modality: 'image',
      capability: 'image.generate',
      provider: 'vertex-gemini',
      model: 'gemini-3.1-flash-image',
      estimatedCredits: 50,
      metadata: {
        traceOnly: true,
        legacyPath: '/proxy/gemini/async',
        useVertex: true,
        registryId: 'gemini-3.1-flash-image',
      },
      input: {
        model: 'gemini-3.1-flash-image',
        estimatedCredits: 50,
      },
    });
  });

  it('extracts trace job ids from gateway responses', () => {
    expect(extractAiGatewayTraceJobId({ job: { id: 'aijob_1' } })).toBe('aijob_1');
    expect(extractAiGatewayTraceJobId({ job: {} })).toBeNull();
  });
});
