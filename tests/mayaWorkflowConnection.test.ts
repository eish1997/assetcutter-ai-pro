import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createCapabilityPackageDraft,
  updateCapabilityPackageDraft,
} from '../local-companion/src/capabilities/capabilityPackageStore.ts';
import { resolveMayaCommandPortTarget } from '../local-companion/src/capabilities/mayaWorkflowConnection.ts';
import { getDefaultMayaCommandPortTarget } from '../local-companion/src/workflows/runtime/mayaCommandPortConnector.ts';

describe('mayaWorkflowConnection', () => {
  let prev: string | undefined;
  let root: string;

  beforeEach(() => {
    prev = process.env.COMPANION_SANDBOX_ROOT;
    root = mkdtempSync(join(tmpdir(), 'maya-wf-conn-'));
    process.env.COMPANION_SANDBOX_ROOT = root;
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.COMPANION_SANDBOX_ROOT;
    else process.env.COMPANION_SANDBOX_ROOT = prev;
    rmSync(root, { recursive: true, force: true });
  });

  it('prefers a connected Maya draft host/port over the default command port', () => {
    const created = createCapabilityPackageDraft({
      id: 'maya',
      type: 'software_connection',
      name: 'Maya',
      manifest: { hostId: 'maya' },
    });
    expect(created.ok).toBe(true);
    updateCapabilityPackageDraft('maya', (draft) => ({
      ...draft,
      lastProbe: {
        ok: true,
        host: '192.168.9.9',
        port: 7123,
        result: { host: '192.168.9.9', port: 7123 },
      },
    }));
    const fallback = getDefaultMayaCommandPortTarget();
    const target = resolveMayaCommandPortTarget('maya');
    expect(target).toEqual({ host: '192.168.9.9', port: 7123 });
    expect(target).not.toEqual(fallback);
  });
});
