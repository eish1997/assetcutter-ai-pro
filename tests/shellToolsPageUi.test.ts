import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('tools page butler door', () => {
  it('opens the tools shelf via openDshHandoff and no longer binds the hidden Copilot', () => {
    const page = readFileSync(join(process.cwd(), 'companion-desktop/shell/tools-page.js'), 'utf8');
    const html = readFileSync(join(process.cwd(), 'companion-desktop/shell/index.html'), 'utf8');

    expect(html).toContain('id="btnToolsAskButler"');
    expect(page).toContain('openToolsWithButler');
    expect(page).toContain('openDshHandoff');
    expect(page).toContain("domain: 'tools'");
    expect(page).toContain("surface: 'tools'");
    expect(page).toContain('请看货架并按需要安装');
    expect(page).toContain('id = \'btnToolsAskButlerEmpty\'');
    expect(page).not.toContain('__acOpenCopilotObjectSession');
  });
});
