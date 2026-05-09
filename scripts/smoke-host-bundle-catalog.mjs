#!/usr/bin/env node
/**
 * 轻量校验 companion-artifacts 公开 catalog（CI / 运维可指向预发或生产）。
 *
 * 用法：
 *   node scripts/smoke-host-bundle-catalog.mjs [catalogUrl]
 *   SMOKE_CATALOG_URL=https://example.com/api/companion-artifacts/catalog node scripts/smoke-host-bundle-catalog.mjs
 *
 * 环境变量：
 *   SMOKE_REQUIRE_HOST_BUNDLE=1  — 要求至少一条 kind=host_plugin_bundle
 *   SMOKE_REQUIRE_PUBLIC_URL=1   — 要求上述条目均含 publicInstallUrl（需服务端配置 COMPANION_DIST_PUBLIC_HTTP_BASE）
 */
const DEFAULT_URL = 'http://127.0.0.1:9100/api/companion-artifacts/catalog';

const url = String(process.env.SMOKE_CATALOG_URL || process.argv[2] || DEFAULT_URL).trim();
const requireHost = String(process.env.SMOKE_REQUIRE_HOST_BUNDLE || '').trim() === '1';
const requirePublic = String(process.env.SMOKE_REQUIRE_PUBLIC_URL || '').trim() === '1';

async function main() {
  console.log('[smoke-host-bundle-catalog] GET', url);
  const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(25000) });
  if (!res.ok) {
    console.error('[smoke-host-bundle-catalog] HTTP', res.status);
    process.exit(1);
  }
  const j = await res.json();
  if (!j || typeof j !== 'object' || !Array.isArray(j.artifacts)) {
    console.error('[smoke-host-bundle-catalog] 响应缺少 artifacts 数组');
    process.exit(1);
  }
  const artifacts = j.artifacts;
  const host = artifacts.filter((a) => a && a.kind === 'host_plugin_bundle');
  const withPublic = host.filter((a) => typeof a.publicInstallUrl === 'string' && /^https:\/\//i.test(a.publicInstallUrl.trim()));

  console.log('[smoke-host-bundle-catalog] 总条数', artifacts.length, '· host_plugin_bundle', host.length);
  if (withPublic.length) {
    console.log('[smoke-host-bundle-catalog] 含 publicInstallUrl 的宿主包', withPublic.length);
  }

  if (requireHost && host.length < 1) {
    console.error('[smoke-host-bundle-catalog] SMOKE_REQUIRE_HOST_BUNDLE=1 但未找到 host_plugin_bundle');
    process.exit(1);
  }
  if (requirePublic && host.length > 0 && withPublic.length < host.length) {
    console.error(
      '[smoke-host-bundle-catalog] SMOKE_REQUIRE_PUBLIC_URL=1 但有宿主包缺少 publicInstallUrl（检查 COMPANION_DIST_PUBLIC_HTTP_BASE）',
    );
    process.exit(1);
  }

  console.log('[smoke-host-bundle-catalog] OK');
}

main().catch((e) => {
  console.error('[smoke-host-bundle-catalog]', e instanceof Error ? e.message : e);
  process.exit(1);
});
