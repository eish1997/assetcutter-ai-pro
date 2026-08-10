import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('shell tool cloud publish UI', () => {
  it('exposes admin cloud publish and cloud-only version switching', () => {
    const preload = readFileSync(join(process.cwd(), 'companion-desktop/preload-shell.cjs'), 'utf8');
    const main = readFileSync(join(process.cwd(), 'companion-desktop/main.cjs'), 'utf8');
    const html = readFileSync(join(process.cwd(), 'companion-desktop/shell/index.html'), 'utf8');
    const page = readFileSync(join(process.cwd(), 'companion-desktop/shell/tools-page.js'), 'utf8');
    const cardSchema = readFileSync(
      join(process.cwd(), 'companion-desktop/shell/capability-card-schema.js'),
      'utf8',
    );
    const versionPicker = readFileSync(
      join(process.cwd(), 'companion-desktop/shell/capability-version-picker.js'),
      'utf8',
    );

    expect(preload).toContain("publishShellToolToCloud: (toolId) => timedInvoke('shell-publish-shell-tool-cloud'");
    expect(main).toContain('async function publishShellToolToCloud');
    expect(main).toContain("String(user.role || '') !== 'admin'");
    expect(main).toContain('/api/admin/companion-artifacts/upload-url');
    expect(main).toContain('/api/admin/companion-artifacts');
    expect(main).toContain("kind: 'shell_tool_bundle'");
    expect(main).toContain('function shellSiteOriginForAuthWrite');
    expect(main).toContain('Origin: writeOrigin');
    expect(main).toContain("credentials: 'include'");
    expect(main).toContain('async function authCookieHeaderForOrigin');
    expect(main).toContain('Cookie: cookieHeader');

    expect(page).toContain('function groupCatalogBundles');
    expect(page).toContain('cur.cloudVersions = catalogVersionsByKey.get(id) || [bundle]');
    expect(page).toContain('mergeCapabilityToolCloudEntries');
    expect(html).toContain('<script src="capability-card-schema.js"></script>');
    expect(html).toContain('<script src="capability-version-picker.js"></script>');
    expect(page).toContain('ShellCapabilityCardSchema');
    expect(page).toContain('ShellCapabilityVersionPicker.pick');
    expect(page).toContain('schema.view(packageLike');
    expect(versionPicker).toContain('schema.versionOptions({ ...(entry || {}), cloudVersions: versions })');
    expect(page).toContain("shell.api('GET', '/v1/capability-packages/cloud'");
    expect(page).toContain('capabilityPackageId');
    expect(page).toContain('capabilityVersion: true');
    expect(page).toContain('const canPublishCloud =');
    expect(cardSchema).toContain("pkg.reviewStatus !== 'approved'");
    expect(page).toContain('tools-card-version');
    expect(page).toContain('tools-card-publish');
    expect(page).toContain('showVersionPicker');
    expect(page).not.toContain('tools-version-dialog');
    expect(page).not.toContain('tools-version-backdrop');
    expect(page).not.toContain('function ensureVersionPickerStyles');
    expect(versionPicker).toContain('capability-version-dialog');
    expect(page).not.toContain('window.prompt(\n        \'\\u9009\\u62e9\\u4e91\\u7aef\\u7248\\u672c');
    expect(page).toContain('async chooseCloudVersion');
    expect(page).toContain('async publishToCloud');
    expect(page).toContain('async fetchToolCapabilityContext');
    expect(page).toContain("'/v1/capability-packages/' + encodeURIComponent(capabilityId) + '/context'");
    expect(page).toContain("type: 'capability'");
    expect(page).toContain('sessionId: session.sessionId');
    expect(page).toContain('fallbackToolCapabilityContext');
    expect(page).not.toContain('contextPrompt: this.toolCopilotContext(toolId)');
    expect(page).toContain("'/v1/capability-packages/' + encodeURIComponent(entry.capabilityPackageId || toolId) + '/cloud-versions'");
    expect(page).toContain("'/cloud-versions/' +");
    expect(page).toContain('versionNote');
    expect(page).toContain("err === 'not_logged_in'");
    expect(page).toContain("await shell.setShellView('workbench')");
    expect(page).toContain("err === 'admin_required'");
    expect(page).toContain("installBundle(shell, bundle, 'switch', entry.local)");
    expect(readFileSync(join(process.cwd(), 'local-companion/src/shellToolAuthored.ts'), 'utf8')).toContain(
      "cur.reviewStatus = 'local'",
    );
  });

  it('refreshes the tool rack when Copilot creates a tool capability', () => {
    const page = readFileSync(join(process.cwd(), 'companion-desktop/shell/tools-page.js'), 'utf8');

    expect(page).toContain("window.addEventListener('assetcutter:capability-created'");
    expect(page).toContain("detail.type !== 'tool'");
    expect(page).toContain('void this.reloadAll(this._shell || shell)');
  });
});
