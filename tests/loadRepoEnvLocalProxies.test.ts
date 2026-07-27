import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  loadRepoEnvLocalProxies,
  outboundProxyConfigured,
} from '../local-companion/src/loadRepoEnvLocalProxies';

describe('loadRepoEnvLocalProxies', () => {
  const prev = {
    TRIPO_PROXY: process.env.TRIPO_PROXY,
    HTTPS_PROXY: process.env.HTTPS_PROXY,
    HTTP_PROXY: process.env.HTTP_PROXY,
  };
  const tmpFiles: string[] = [];

  afterEach(() => {
    for (const f of tmpFiles) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* ignore */
      }
    }
    tmpFiles.length = 0;
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('loads missing proxy keys from env file and does not override existing', () => {
    delete process.env.TRIPO_PROXY;
    delete process.env.HTTPS_PROXY;
    process.env.HTTP_PROXY = 'http://keep-me:1';

    const file = path.join(os.tmpdir(), `ac-env-proxy-${Date.now()}.env`);
    tmpFiles.push(file);
    fs.writeFileSync(
      file,
      ['TRIPO_PROXY=http://127.0.0.1:7890', 'HTTPS_PROXY=http://should-apply:7890', 'HTTP_PROXY=http://ignored:9', 'OTHER=x'].join(
        '\n'
      ),
      'utf8'
    );

    const applied = loadRepoEnvLocalProxies(file);
    expect(applied.sort()).toEqual(['HTTPS_PROXY', 'TRIPO_PROXY'].sort());
    expect(process.env.TRIPO_PROXY).toBe('http://127.0.0.1:7890');
    expect(process.env.HTTPS_PROXY).toBe('http://should-apply:7890');
    expect(process.env.HTTP_PROXY).toBe('http://keep-me:1');
    expect(outboundProxyConfigured()).toBe(true);
  });
});
