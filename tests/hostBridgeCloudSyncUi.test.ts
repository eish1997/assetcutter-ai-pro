import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('host bridge cloud sync wiring', () => {
  it('exposes server APIs and desktop cloud sync hooks for host bridges', () => {
    const authApi = readFileSync(join(process.cwd(), 'server/auth-api.js'), 'utf8');
    const main = readFileSync(join(process.cwd(), 'companion-desktop/main.cjs'), 'utf8');
    const preload = readFileSync(join(process.cwd(), 'companion-desktop/preload-shell.cjs'), 'utf8');
    const http = readFileSync(join(process.cwd(), 'local-companion/src/httpHandler.ts'), 'utf8');

    expect(authApi).toContain("path === '/api/host-bridges'");
    expect(authApi).toContain('api\\/admin\\/host-bridges');
    expect(authApi).toContain('admin.host_bridge_version_publish');
    expect(authApi).toContain('admin.host_bridge_version_activate');
    expect(authApi).toContain('function hostBridgeErrorMessage');
    expect(authApi).toContain('host_id_mismatch');
    expect(authApi).toContain('提交路径中的宿主 id 与宿主定义 id 不一致。');
    expect(authApi).toContain('桥接模板未注册，不能提交云端。');
    expect(authApi).toContain('HTTP 探测路径必须为 /health。');
    expect(authApi).toContain('心跳文件路径不安全。');
    expect(authApi).toContain('message: hostBridgeErrorMessage(message)');
    expect(authApi).toContain("hostBridgeErrorMessage('host_id_mismatch')");

    expect(preload).toContain("syncHostBridgesFromCloud: () => timedInvoke('shell-sync-host-bridges-cloud'");
    expect(preload).toContain("publishHostBridgeToCloud: (payload) => timedInvoke('shell-publish-host-bridge-cloud'");
    expect(preload).toContain("activateHostBridgeCloudVersion: (payload) => timedInvoke('shell-activate-host-bridge-cloud-version'");

    expect(main).toContain('async function syncHostBridgesFromCloud');
    expect(main).toContain('async function publishHostBridgeToCloud');
    expect(main).toContain('async function activateHostBridgeCloudVersion');
    expect(main).toContain('/api/host-bridges');
    expect(main).toContain('/api/admin/host-bridges/');
    expect(main).toContain('/v1/bridges/cloud/sync');
    expect(main).toContain("String(user.role || '') !== 'admin'");
    expect(main).toContain('skipped: Number(synced.json?.skipped) || 0');

    expect(http).toContain("path === '/v1/bridges/cloud/sync'");
    expect(http).toContain('syncHostBridgeCloudVersionsFromRemote');
    expect(http).toContain('sendJson(res, result.ok ? 200 : 400, result, origin)');
  });
});
