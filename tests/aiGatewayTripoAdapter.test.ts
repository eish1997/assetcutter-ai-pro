import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAiGatewayJobPlan } from '../server/ai-gateway/index.js';
import { createInMemoryAiJobStore } from '../server/ai-gateway/job-store.js';
import { saveProviderKeys } from '../server/ai-gateway/provider-key-store.js';
import { startAiGatewayJobExecution } from '../server/ai-gateway/executor.js';
import { cancelAiGatewayWorkerExecution } from '../server/ai-gateway/workers/registry.js';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  };
}

describe('Tripo OpenAPI AI gateway worker', () => {
  const prevPath = process.env.AI_GATEWAY_PROVIDER_KEYS_PATH;
  const prevExecution = process.env.AI_GATEWAY_EXECUTION_ENABLED;
  const tempFiles = new Set<string>();

  afterEach(() => {
    if (prevPath === undefined) delete process.env.AI_GATEWAY_PROVIDER_KEYS_PATH;
    else process.env.AI_GATEWAY_PROVIDER_KEYS_PATH = prevPath;
    if (prevExecution === undefined) delete process.env.AI_GATEWAY_EXECUTION_ENABLED;
    else process.env.AI_GATEWAY_EXECUTION_ENABLED = prevExecution;
    for (const file of tempFiles) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        // ignore temp cleanup failures
      }
    }
    tempFiles.clear();
  });

  function useTempKeyStore() {
    const file = path.join(os.tmpdir(), `ac-tripo-keys-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    tempFiles.add(file);
    process.env.AI_GATEWAY_PROVIDER_KEYS_PATH = file;
  }

  it('starts a model3d task through Tripo and stores model artifacts only as URLs', async () => {
    useTempKeyStore();
    delete process.env.AI_GATEWAY_EXECUTION_ENABLED;
    await saveProviderKeys([
      { id: 'tripo_key_1', provider: 'tripo', label: 'Tripo primary', secret: 'tripo-secret', enabled: true, priority: 1 },
    ]);

    const store = createInMemoryAiJobStore();
    const plan = await store.put(createAiGatewayJobPlan({
      id: 'aijob_tripo_1',
      modality: 'model3d',
      input: { prompt: 'small stylized crate', texture: true, estimatedCredits: 42 },
    }));
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ task_id: 'tripo_task_1', status: 'queued' }, true, 200))
      .mockResolvedValueOnce(jsonResponse({
        status: 'success',
        output: {
          model: 'https://cdn.example.com/model.glb',
          preview: 'https://cdn.example.com/preview.png',
        },
      }, true, 200));

    const result = await startAiGatewayJobExecution(plan, {
      store,
      fetchImpl,
      pollIntervalMs: 1,
      pollTimeoutMs: 50,
      awaitBackgroundPoll: true,
    });

    expect(result.started).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.tripo3d.ai/v2/openapi/task');
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer tripo-secret');
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({
      type: 'text_to_model',
      prompt: 'small stylized crate',
      texture: true,
    });
    expect(fetchImpl.mock.calls[1][0]).toBe('https://api.tripo3d.ai/v2/openapi/task/tripo_task_1');

    const stored = await store.get('aijob_tripo_1');
    expect(stored.job.status).toBe('succeeded');
    expect(stored.job.metadata).toMatchObject({
      tripoTaskId: 'tripo_task_1',
      upstreamTaskId: 'tripo_task_1',
      usage: {
        provider: 'tripo',
        upstreamTaskId: 'tripo_task_1',
        billingSku: '3d.tripo.task',
        meterKind: 'task',
        quantity: 1,
        artifactCount: 1,
      },
      gatewayExecution: {
        artifactCount: 1,
      },
    });
    expect(stored.job.artifacts).toEqual([
      expect.objectContaining({
        kind: 'model3d',
        url: 'https://cdn.example.com/model.glb',
        source: 'tripo',
        billing: expect.objectContaining({ settlementSource: 'provider_task_usage' }),
      }),
    ]);
  });

  it('returns an explicit soft-cancel result when Tripo hard cancel is unavailable', async () => {
    const plan = createAiGatewayJobPlan({
      id: 'aijob_tripo_cancel',
      modality: 'model3d',
      input: { prompt: 'crate' },
      metadata: { tripoTaskId: 'tripo_task_cancel', upstreamTaskId: 'tripo_task_cancel' },
    });

    await expect(cancelAiGatewayWorkerExecution(plan)).resolves.toMatchObject({
      cancelled: false,
      mode: 'soft',
      reason: 'tripo_hard_cancel_unavailable',
      upstreamTaskId: 'tripo_task_cancel',
    });
  });

  it('uploads image inputs before creating Tripo image_to_model tasks', async () => {
    useTempKeyStore();
    await saveProviderKeys([
      { id: 'tripo_key_img', provider: 'tripo', label: 'Tripo image', secret: 'tripo-secret', enabled: true, priority: 1 },
    ]);

    const store = createInMemoryAiJobStore();
    const plan = await store.put(createAiGatewayJobPlan({
      id: 'aijob_tripo_image',
      modality: 'model3d',
      input: {
        type: 'image_to_model',
        imageBase64DataUrl: 'data:image/png;base64,QUJDRA==',
        texture: true,
      },
    }));
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ file_token: 'file_token_1' }, true, 200))
      .mockResolvedValueOnce(jsonResponse({ task_id: 'tripo_task_img', status: 'queued' }, true, 200));

    const result = await startAiGatewayJobExecution(plan, {
      store,
      fetchImpl,
      disableBackgroundPoll: true,
    });

    expect(result.started).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.tripo3d.ai/v2/openapi/upload/sts');
    expect(fetchImpl.mock.calls[1][0]).toBe('https://api.tripo3d.ai/v2/openapi/task');
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toMatchObject({
      type: 'image_to_model',
      texture: true,
      file: { type: 'jpg', file_token: 'file_token_1' },
    });
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).imageBase64DataUrl).toBeUndefined();
  });
});
