import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  DSH_SESSION_PARTITION,
  TEAM_SESSION_PARTITION,
  isDshPartitionAllowed,
} = require('../companion-desktop/dsh-workbench-views.cjs') as {
  DSH_SESSION_PARTITION: string;
  TEAM_SESSION_PARTITION: string;
  isDshPartitionAllowed: (partition: string) => boolean;
};

describe('dsh partition guard', () => {
  it('keeps dsh BrowserView off the team partition', () => {
    expect(DSH_SESSION_PARTITION).toBe('persist:assetcutter-dsh');
    expect(DSH_SESSION_PARTITION).not.toBe(TEAM_SESSION_PARTITION);
    expect(isDshPartitionAllowed(TEAM_SESSION_PARTITION)).toBe(false);
    const main = fs.readFileSync(path.resolve(process.cwd(), 'companion-desktop/main.cjs'), 'utf8');
    expect(main).toContain('partition: DSH_SESSION_PARTITION');
    expect(main).toContain('isDshPartitionAllowed');
  });
});
