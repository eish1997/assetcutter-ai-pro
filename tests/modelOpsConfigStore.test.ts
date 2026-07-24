import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  normalizeModelOpsConfig,
  readModelOpsConfig,
  resolveModelOpsConfigSource,
  writeModelOpsConfig,
} from '../server/ai-gateway/model-ops-config-store.js';

describe('model ops config store', () => {
  const prevPath = process.env.MODEL_OPS_CONFIG_PATH;
  const prevSource = process.env.MODEL_OPS_CONFIG_SOURCE;
  const tempFiles = new Set<string>();

  afterEach(() => {
    if (prevPath === undefined) delete process.env.MODEL_OPS_CONFIG_PATH;
    else process.env.MODEL_OPS_CONFIG_PATH = prevPath;
    if (prevSource === undefined) delete process.env.MODEL_OPS_CONFIG_SOURCE;
    else process.env.MODEL_OPS_CONFIG_SOURCE = prevSource;
    for (const file of tempFiles) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        // ignore temp cleanup failures
      }
    }
    tempFiles.clear();
  });

  it('normalizes published canonical model allowlist', () => {
    expect(
      normalizeModelOpsConfig({
        version: 2,
        publishedCanonicalModelAllowlist: ['gpt-4o-mini', ' gpt-4o-mini ', '', 'gemini-2.5-flash-image'],
      })
    ).toMatchObject({
      version: 2,
      publishedCanonicalModelAllowlist: ['gpt-4o-mini', 'gemini-2.5-flash-image'],
    });
  });

  it('keeps route fallback policy and endpoint mappings', () => {
    expect(
      normalizeModelOpsConfig({
        version: 4,
        bindingOverrides: [
          {
            bindingId: 'gpt-image-2:302ai-openai:image',
            priority: 8,
            fallbackPolicy: 'cost_optimized',
            fallbackMaxAttempts: 2,
          },
        ],
        providerOverrides: [
          {
            providerId: '302ai',
            baseUrl: 'https://proxy.example/302ai/v1/',
            requestTimeoutMs: 45_500,
          },
          {
            providerId: 'aihubmix',
            baseUrl: 'not-a-url',
            requestTimeoutMs: 0,
          },
        ],
        endpointMappings: [
          {
            routeId: '302ai-video-manual:302ai:video',
            method: 'post',
            requestPath: '/submit',
            pollPath: '/tasks/{id}',
            statusPath: 'data.status',
            artifactPath: 'data.video.url',
            taskIdPath: 'data.taskId',
            errorPath: 'error.message',
            artifactUrlPath: 'data.video.url',
            upstreamOverride: 'kling-video-v1',
            priority: 25,
          },
        ],
      })
    ).toMatchObject({
      bindingOverrides: [
        {
          bindingId: 'gpt-image-2:302ai-openai:image',
          priority: 8,
          fallbackPolicy: 'cost_optimized',
          fallbackMaxAttempts: 2,
        },
      ],
      providerOverrides: [
        {
          providerId: '302ai',
          baseUrl: 'https://proxy.example/302ai/v1',
          requestTimeoutMs: 45_500,
        },
        {
          providerId: 'aihubmix',
          baseUrl: undefined,
          requestTimeoutMs: undefined,
        },
      ],
      endpointMappings: [
        {
          routeId: '302ai-video-manual:302ai:video',
          method: 'POST',
          requestPath: '/submit',
          pollPath: '/tasks/{id}',
          statusPath: 'data.status',
          artifactPath: 'data.video.url',
          taskIdPath: 'data.taskId',
          errorPath: 'error.message',
          artifactUrlPath: 'data.video.url',
          upstreamOverride: 'kling-video-v1',
          priority: 25,
        },
      ],
    });
  });

  it('writes and reads disk backed model ops config', async () => {
    const file = path.join(os.tmpdir(), `ac-model-ops-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    tempFiles.add(file);
    process.env.MODEL_OPS_CONFIG_PATH = file;
    process.env.MODEL_OPS_CONFIG_SOURCE = 'disk';

    const saved = await writeModelOpsConfig(
      {
        version: 3,
        publishedCanonicalModelAllowlist: ['gpt-4o-mini'],
      },
      { updatedByUserId: 'user_admin' }
    );
    const read = await readModelOpsConfig();

    expect(saved.publishedCanonicalModelAllowlist).toEqual(['gpt-4o-mini']);
    expect(read.publishedCanonicalModelAllowlist).toEqual(['gpt-4o-mini']);
    expect(read.updatedByUserId).toBe('user_admin');
    expect(read.storage).toBe('disk');
    expect(read.source).toBe('disk');
  });

  it('falls back to disk when db source is requested without postgres', () => {
    process.env.MODEL_OPS_CONFIG_SOURCE = 'db';
    expect(resolveModelOpsConfigSource()).toBe('disk');
  });
});
