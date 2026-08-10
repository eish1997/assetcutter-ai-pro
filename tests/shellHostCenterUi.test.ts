import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('legacy host center UI', () => {
  it('removes host center and secondary navigation from the tools page', () => {
    const html = readFileSync(join(process.cwd(), 'companion-desktop/shell/index.html'), 'utf8');
    const toolsPage = readFileSync(join(process.cwd(), 'companion-desktop/shell/tools-page.js'), 'utf8');
    const bridges = readFileSync(join(process.cwd(), 'companion-desktop/shell/tools-bridges.js'), 'utf8');

    expect(html).toContain('data-view="connections"');
    expect(html).toContain('id="view-connections"');
    expect(html).toContain('id="btnConnectionCreateWithCopilot"');
    expect(html).toContain('<section class="tools-section-panel is-active" id="tools-rack" data-tools-section-panel="rack">');
    expect(html).not.toContain('tools-section-nav');
    expect(html).not.toContain('data-tools-section="bridges"');
    expect(html).not.toContain('id="tools-bridges"');
    expect(html).not.toContain('id="btnBridgesRefresh"');
    expect(html).not.toContain('id="bridgesList"');
    expect(html).not.toContain('<script src="tools-bridges.js"></script>');

    expect(toolsPage).not.toContain('ShellToolsBridges');
    expect(toolsPage).not.toContain('loadLegacyBridgesDebugModule');
    expect(toolsPage).not.toContain("script.src = 'tools-bridges.js'");
    expect(toolsPage).not.toContain('openLegacyBridgesDebug');
    expect(bridges).toContain('HOST_CENTER_FALLBACK_CATALOG');
    expect(bridges).toContain("'/v1/bridges'");
  });

  it('preserves real-probe and Copilot safeguards in the legacy bridge implementation', () => {
    const bridges = readFileSync(join(process.cwd(), 'companion-desktop/shell/tools-bridges.js'), 'utf8');
    const http = readFileSync(join(process.cwd(), 'local-companion/src/httpHandler.ts'), 'utf8');
    const body = readFileSync(join(process.cwd(), 'companion-desktop/agent-body-host.cjs'), 'utf8');

    expect(bridges).toContain('heartbeat file was not found');
    expect(bridges).toContain('command port probe timed out');
    expect(bridges).toContain('__acOpenCopilotObjectSession');
    expect(bridges).toContain('hostAcceptanceGuide');
    expect(http).toContain('withHostBridgeAcceptance');
    expect(http).toContain('writeHostBridgeAcceptanceRecord');
    expect(body).toContain("name === 'ac.companion.host_bridge.probe'");
    expect(body).toContain("`/v1/bridges/${encodeURIComponent(id)}/probe`");
  });
});
