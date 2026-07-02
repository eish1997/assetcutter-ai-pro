import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { findHermesCli, hermesEnvPath, hermesHomeDir } = require('../companion-desktop/hermes-cli-resolve.cjs');

describe('hermesCliResolve', () => {
  it('hermesHomeDir uses LOCALAPPDATA on win32', () => {
    if (process.platform !== 'win32') return;
    const home = hermesHomeDir();
    expect(home.toLowerCase()).toContain('appdata');
    expect(home.toLowerCase()).toContain('hermes');
  });

  it('hermesEnvPath is under hermes home', () => {
    expect(hermesEnvPath()).toBe(require('path').join(hermesHomeDir(), '.env'));
  });

  it('findHermesCli resolves venv Scripts on typical Windows install', () => {
    if (process.platform !== 'win32') return;
    const cli = findHermesCli();
    if (cli) {
      expect(cli.toLowerCase()).toMatch(/hermes\.exe$/);
      expect(cli.toLowerCase()).toContain('venv');
    }
  });
});
