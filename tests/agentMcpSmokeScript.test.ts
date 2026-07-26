import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('agent-mcp-smoke (retired)', () => {
  it('script exits with MCP removed message', async () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/agent-mcp-smoke.mjs');
    expect(fs.existsSync(scriptPath)).toBe(true);
    const text = fs.readFileSync(scriptPath, 'utf8');
    expect(text).toContain('removed');
    expect(text).toContain('agent:cli');
  });

  it('package.json no longer exposes smoke:agent-mcp scripts', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));
    const keys = Object.keys(pkg.scripts || {});
    expect(keys.some((k) => k.startsWith('smoke:agent-mcp'))).toBe(false);
    expect(pkg.scripts['agent:cli']).toBeTruthy();
    expect(pkg.scripts['agent:init']).toBeTruthy();
  });
});
