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
