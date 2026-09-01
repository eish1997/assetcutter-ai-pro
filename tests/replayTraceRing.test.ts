import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createReplayTraceRing } = require('../companion-desktop/replay-trace-ring.cjs') as {
  createReplayTraceRing: (opts?: { max?: number }) => {
    append: (entry: { args?: unknown; tool: string }) => number;
    list: () => Array<{ args: unknown; tool: string }>;
  };
};

describe('replay trace ring', () => {
  it('keeps insertion order and drops the oldest past max', () => {
    const ring = createReplayTraceRing({ max: 2 });
    ring.append({ tool: 'workspace_dispatch', args: { type: 'set_finger', n: 1 } });
    ring.append({ tool: 'workspace_dispatch', args: { type: 'set_finger', n: 2 } });
    ring.append({ tool: 'host_invoke_primitive', args: { primitiveId: 'host.import_file' } });
    const listed = ring.list();
    expect(listed).toHaveLength(2);
    expect(listed[0].tool).toBe('workspace_dispatch');
    expect((listed[0].args as { n: number }).n).toBe(2);
    expect(listed[1].tool).toBe('host_invoke_primitive');
  });
});
