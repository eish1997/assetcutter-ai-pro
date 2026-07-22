import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const s3Mocks = vi.hoisted(() => ({
  send: vi.fn(),
  PutObjectCommand: vi.fn(function PutObjectCommand(input) {
    this.input = input;
  }),
  S3Client: vi.fn(function S3Client(config) {
    this.config = config;
    this.send = s3Mocks.send;
  }),
}));

const r2Mocks = vi.hoisted(() => ({
  isR2Configured: vi.fn(() => false),
  putPublicR2Object: vi.fn(),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  PutObjectCommand: s3Mocks.PutObjectCommand,
  S3Client: s3Mocks.S3Client,
}));

vi.mock('../server/r2-storage-handlers.js', () => ({
  isR2Configured: r2Mocks.isR2Configured,
  putPublicR2Object: r2Mocks.putPublicR2Object,
}));

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
    s3Mocks.send.mockReset();
    s3Mocks.PutObjectCommand.mockClear();
    s3Mocks.S3Client.mockClear();
    r2Mocks.isR2Configured.mockReset();
    r2Mocks.isR2Configured.mockReturnValue(false);
    r2Mocks.putPublicR2Object.mockReset();
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
    expect(stored.job.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'model3d',
          url: 'https://cdn.example.com/model.glb',
          source: 'tripo',
          billing: expect.objectContaining({ settlementSource: 'provider_task_usage' }),
        }),
        expect.objectContaining({
          kind: 'image',
          url: 'https://cdn.example.com/preview.png',
          source: 'tripo',
          role: 'preview',
        }),
      ])
    );
  });

  it('keeps polling when Tripo reports success before model artifacts are ready', async () => {
    useTempKeyStore();
    delete process.env.AI_GATEWAY_EXECUTION_ENABLED;
    await saveProviderKeys([
      { id: 'tripo_key_pending', provider: 'tripo', label: 'Tripo primary', secret: 'tripo-secret', enabled: true, priority: 1 },
    ]);

    const store = createInMemoryAiJobStore();
    const plan = await store.put(createAiGatewayJobPlan({
      id: 'aijob_tripo_pending_artifact',
      modality: 'model3d',
      input: { prompt: 'small stylized crate' },
    }));
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ task_id: 'tripo_task_pending', status: 'queued' }, true, 200))
      .mockResolvedValueOnce(jsonResponse({
        status: 'success',
        output: {
          rendered_image: 'https://cdn.example.com/preview.png',
        },
      }, true, 200))
      .mockResolvedValueOnce(jsonResponse({
        status: 'success',
        output: {
          model: 'https://cdn.example.com/model.glb',
          rendered_image: 'https://cdn.example.com/preview.png',
        },
      }, true, 200));

    await startAiGatewayJobExecution(plan, {
      store,
      fetchImpl,
      pollIntervalMs: 1,
      pollTimeoutMs: 50,
      awaitBackgroundPoll: true,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const stored = await store.get('aijob_tripo_pending_artifact');
    expect(stored.job.status).toBe('succeeded');
    expect(stored.job.output.modelUrls).toEqual(['https://cdn.example.com/model.glb']);
    expect(stored.job.metadata.gatewayExecution.artifactCount).toBe(1);
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
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { image_token: 'image_token_1' } }, true, 200))
      .mockResolvedValueOnce(jsonResponse({ task_id: 'tripo_task_img', status: 'queued' }, true, 200));

    const result = await startAiGatewayJobExecution(plan, {
      store,
      fetchImpl,
      disableBackgroundPoll: true,
    });

    expect(result.started).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.tripo3d.ai/v2/openapi/upload');
    expect(fetchImpl.mock.calls[0][1].body).toBeInstanceOf(FormData);
    expect(s3Mocks.send).not.toHaveBeenCalled();
    expect(fetchImpl.mock.calls[1][0]).toBe('https://api.tripo3d.ai/v2/openapi/task');
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toMatchObject({
      type: 'image_to_model',
      texture: true,
      file: { type: 'png', file_token: 'image_token_1' },
    });
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).imageBase64DataUrl).toBeUndefined();
  });

  it('falls back to Tripo STS when direct upload is rejected', async () => {
    useTempKeyStore();
    await saveProviderKeys([
      { id: 'tripo_key_img_retry', provider: 'tripo', label: 'Tripo image retry', secret: 'tripo-secret', enabled: true, priority: 1 },
    ]);

    const store = createInMemoryAiJobStore();
    const plan = await store.put(createAiGatewayJobPlan({
      id: 'aijob_tripo_image_retry',
      modality: 'model3d',
      input: {
        type: 'image_to_model',
        imageBase64DataUrl: 'data:image/jpeg;base64,QUJDRA==',
      },
    }));
    s3Mocks.send.mockResolvedValueOnce({});
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ code: 1004, message: 'One or more of your parameter is invalid' }, false, 400))
      .mockResolvedValueOnce(jsonResponse({
        code: 0,
        data: {
          s3_host: 's3.us-west-2.amazonaws.com',
          resource_bucket: 'tripo-data',
          resource_uri: 'uploads/input.jpg',
          session_token: 'session-token',
          sts_ak: 'sts-ak',
          sts_sk: 'sts-sk',
        },
      }, true, 200))
      .mockResolvedValueOnce(jsonResponse({ task_id: 'tripo_task_img_retry', status: 'queued' }, true, 200));

    const result = await startAiGatewayJobExecution(plan, {
      store,
      fetchImpl,
      disableBackgroundPoll: true,
    });

    expect(result.started).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.tripo3d.ai/v2/openapi/upload');
    expect(fetchImpl.mock.calls[1][0]).toBe('https://api.tripo3d.ai/v2/openapi/upload/sts');
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({ format: 'jpeg' });
    expect(s3Mocks.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchImpl.mock.calls[2][1].body)).toMatchObject({
      type: 'image_to_model',
      file: { type: 'jpg', file_token: 'uploads/input.jpg' },
    });
  });

  it('publishes data URL references to public R2 before creating Tripo image tasks', async () => {
    useTempKeyStore();
    await saveProviderKeys([
      { id: 'tripo_key_img_r2', provider: 'tripo', label: 'Tripo image R2', secret: 'tripo-secret', enabled: true, priority: 1 },
    ]);
    r2Mocks.isR2Configured.mockReturnValue(true);
    r2Mocks.putPublicR2Object.mockResolvedValueOnce({
      objectKey: 'public/ai-gateway-inputs/user/aijob/input.jpg',
      publicUrl: 'https://cdn.example.com/public/ai-gateway-inputs/user/aijob/input.jpg',
    });

    const store = createInMemoryAiJobStore();
    const plan = await store.put(createAiGatewayJobPlan({
      id: 'aijob_tripo_image_r2',
      modality: 'model3d',
      input: {
        type: 'image_to_model',
        imageBase64DataUrl: 'data:image/jpeg;base64,QUJDRA==',
      },
    }));
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ task_id: 'tripo_task_img_r2', status: 'queued' }, true, 200));

    const result = await startAiGatewayJobExecution(plan, {
      store,
      fetchImpl,
      disableBackgroundPoll: true,
    });

    expect(result.started).toBe(true);
    expect(r2Mocks.putPublicR2Object).toHaveBeenCalledWith(
      expect.stringMatching(/^public\/ai-gateway-inputs\/anonymous\/aijob_tripo_image_r2\//),
      expect.any(Buffer),
      { contentType: 'image/jpeg' }
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.tripo3d.ai/v2/openapi/task');
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({
      type: 'image_to_model',
      file: { type: 'url', url: 'https://cdn.example.com/public/ai-gateway-inputs/user/aijob/input.jpg' },
    });
  });
});
