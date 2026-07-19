import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/jimeng-credits-gate.js', () => ({
  assertJimengCreditsGate: vi.fn(),
  estimatedCreditsForJimengRegistry: vi.fn((id: string) =>
    id.startsWith('jimeng-video') ? 100 : 50
  ),
}));

import { assertJimengCreditsGate } from '../server/jimeng-credits-gate.js';
import {
  callJimengVisualApi,
  getJimengStatusResponse,
  isJimengServiceAvailable,
  normalizeJimengPollResult,
  pollJimengTask,
  resetJimengPollCountersForTests,
  resolveJimengReqKey,
  submitJimengTask,
} from '../server/jimeng-visual-api.js';

function assertNotOk<T extends { ok: boolean }>(
  r: T
): asserts r is Extract<T, { ok: false }> {
  if (r.ok) throw new Error('expected failure');
}

describe('jimeng api routes (mock upstream)', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            code: 10000,
            data: { task_id: 'task-mock-001', status: 'done', image_urls: ['https://example.com/a.png'] },
          }),
      }))
    );
    vi.mocked(assertJimengCreditsGate).mockResolvedValue({ ok: true });
    process.env.VOLCENGINE_ACCESS_KEY = 'ak-test';
    process.env.VOLCENGINE_SECRET_KEY = 'sk-test';
    process.env.JIMENG_API_ENABLED = 'true';
    resetJimengPollCountersForTests();
  });

  afterEach(() => {
    process.env = { ...envBackup };
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    resetJimengPollCountersForTests();
  });

  it('GET /api/jimeng/status 语义：enabled 需开关 + AK', () => {
    expect(getJimengStatusResponse()).toEqual({ enabled: true, configured: true });
    process.env.JIMENG_API_ENABLED = 'false';
    expect(getJimengStatusResponse()).toEqual({ enabled: false, configured: true });
    delete process.env.VOLCENGINE_ACCESS_KEY;
    expect(getJimengStatusResponse()).toEqual({ enabled: false, configured: false });
  });

  it('JIMENG_API_ENABLED=false 时 isJimengServiceAvailable 为 false', () => {
    process.env.JIMENG_API_ENABLED = 'false';
    expect(isJimengServiceAvailable()).toBe(false);
  });

  it('verified registryId 映射 req_key', () => {
    expect(resolveJimengReqKey('jimeng-image-t2i-v40')).toEqual({
      reqKey: 'jimeng_t2i_v40',
      modality: 'image',
    });
    expect(resolveJimengReqKey('jimeng-video-ti2v-v30-pro')).toEqual({
      reqKey: 'jimeng_ti2v_v30_pro',
      modality: 'video',
    });
    expect(resolveJimengReqKey('jimeng-image-t2i-v30')).toBeNull();
  });

  it('POST submit 成功返回 taskId', async () => {
    const result = await submitJimengTask({
      registryId: 'jimeng-image-t2i-v40',
      prompt: 'a cat',
      width: 1024,
      height: 1024,
    });
    expect(result).toEqual({ ok: true, taskId: 'task-mock-001' });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('Action=CVSync2AsyncSubmitTask');
    expect(url).toContain('Version=2022-08-31');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: expect.stringContaining('HMAC-SHA256 Credential=ak-test/'),
    });
    const body = JSON.parse(String(init.body));
    expect(body.req_key).toBe('jimeng_t2i_v40');
    expect(body.prompt).toBe('a cat');
  });

  it('POST submit 未知 registryId → 400', async () => {
    const result = await submitJimengTask({ registryId: 'jimeng-image-t2i-v30', prompt: 'x' });
    expect(result.ok).toBe(false);
    assertNotOk(result);
    expect(result.status).toBe(400);
    expect(result.body.code).toBe('JIMENG_REGISTRY_UNKNOWN');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('POST submit surfaces Volcengine auth errors instead of a generic failure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ResponseMetadata: {
            Error: {
              Code: 'InvalidAccessKey',
              Message: 'The security token[ak-test] included in the request is invalid.',
            },
          },
        }),
        { status: 401 }
      )
    );

    const result = await submitJimengTask({
      registryId: 'jimeng-image-t2i-v40',
      prompt: 'x',
    });

    expect(result.ok).toBe(false);
    assertNotOk(result);
    expect(result.status).toBe(401);
    expect(result.body.error).toContain('InvalidAccessKey');
    expect(result.body.error).toContain('security token');
  });

  it('GET poll 归一化 done', async () => {
    const poll = await pollJimengTask('task-mock-001', 'jimeng-image-t2i-v40', { userId: 'u1' });
    expect(poll.ok).toBe(true);
    if (poll.ok) {
      expect(poll.body).toEqual({
        status: 'done',
        images: ['https://example.com/a.png'],
      });
    }
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url] = vi.mocked(fetch).mock.calls[0] as [string];
    expect(url).toContain('Action=CVSync2AsyncGetResult');
  });

  it('normalizeJimengPollResult pending / failed', () => {
    expect(normalizeJimengPollResult({ code: 10000, data: { status: 'processing' } })).toEqual({
      status: 'running',
    });
    expect(normalizeJimengPollResult({ code: 50411, message: 'not enabled' })).toEqual({
      status: 'failed',
      code: 50411,
      message: 'not enabled',
    });
  });

  it('credits-gate 可被路由层调用（mock）', async () => {
    vi.mocked(assertJimengCreditsGate).mockResolvedValueOnce({
      ok: false,
      status: 401,
      body: { error: '请先登录', code: 'LOGIN_REQUIRED' },
    });
    const gate = await assertJimengCreditsGate({ headers: {} } as never, 'jimeng-image-t2i-v40');
    expect(gate.ok).toBe(false);
    assertNotOk(gate);
    expect(gate.body.code).toBe('LOGIN_REQUIRED');
  });

  it('callJimengVisualApi 透传上游 JSON', async () => {
    const upstream = await callJimengVisualApi('CVSync2AsyncGetResult', {
      req_key: 'jimeng_t2i_v40',
      task_id: 't1',
    });
    expect(upstream.ok).toBe(true);
    expect(upstream.data.code).toBe(10000);
  });
});
