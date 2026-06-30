import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  P0_TOOL_SCHEMAS,
  P1_TOOL_SCHEMAS,
  ALL_TOOL_SCHEMAS,
  VALID_SHELL_VIEWS,
  validateArgs,
} = require('../companion-desktop/agent-body-host.cjs');

describe('agent P0 tool schemas', () => {
  it('registers exactly three P0 ac.* tools', () => {
    expect(P0_TOOL_SCHEMAS).toHaveLength(3);
    for (const t of P0_TOOL_SCHEMAS) {
      expect(t.name.startsWith('ac.')).toBe(true);
      expect(t.risk).toBe('safe');
    }
    const names = P0_TOOL_SCHEMAS.map((t: { name: string }) => t.name);
    expect(names).toEqual([
      'ac.shell.navigate',
      'ac.shell.get_state',
      'ac.companion.runtime_status',
    ]);
  });

  it('navigate view enum matches shell views', () => {
    const nav = P0_TOOL_SCHEMAS.find((t: { name: string }) => t.name === 'ac.shell.navigate');
    expect(nav).toBeTruthy();
    const enumValues: string[] = nav.inputSchema.properties.view.enum;
    for (const v of enumValues) {
      expect(VALID_SHELL_VIEWS.has(v)).toBe(true);
    }
    expect(enumValues).toContain('scripts');
  });

  it('validateArgs rejects unknown navigate view', () => {
    const nav = P0_TOOL_SCHEMAS.find((t: { name: string }) => t.name === 'ac.shell.navigate');
    const r = validateArgs(nav.inputSchema, { view: 'not-a-view' });
    expect(r.ok).toBe(false);
  });

  it('validateArgs accepts scripts navigate', () => {
    const nav = P0_TOOL_SCHEMAS.find((t: { name: string }) => t.name === 'ac.shell.navigate');
    const r = validateArgs(nav.inputSchema, { view: 'scripts' });
    expect(r.ok).toBe(true);
    expect(r.value.view).toBe('scripts');
  });
});

describe('agent P1 tool schemas', () => {
  it('registers nine P1 tools', () => {
    expect(P1_TOOL_SCHEMAS).toHaveLength(9);
  });

  it('ALL_TOOL_SCHEMAS combines P0 P1 P2', () => {
    expect(ALL_TOOL_SCHEMAS).toHaveLength(16);
  });
});
