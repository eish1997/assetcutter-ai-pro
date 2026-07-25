#!/usr/bin/env node
/**
 * C14 — R2 media durability smoke.
 *
 * - No R2 on auth healthz → WARN/SKIP (optional)
 * - R2 on + recent succeeded job with archived image URL → HEAD/GET must 200
 *
 *   npm run smoke:ai-gateway-r2
 */

import { fetch } from 'undici';
import {
  AdminClient,
  DEFAULT_AUTH,
  DEFAULT_ORIGIN,
  classifyAdminPrereq,
  exitCodeForStatus,
  isSmokeOptional,
} from './ai-gateway-smoke-lib.mjs';

export function classifyR2MediaPrereq({ r2Configured, hasArchivedUrl }) {
  if (!r2Configured) {
    return { status: 'skipped', reason: 'r2_not_configured' };
  }
  if (!hasArchivedUrl) {
    return { status: 'skipped', reason: 'no_archived_media_sample' };
  }
  return { status: 'ready', reason: 'ok' };
}

async function headOrGetOk(url) {
  const head = await fetch(url, { method: 'HEAD', redirect: 'follow' });
  if (head.ok) return { ok: true, method: 'HEAD', status: head.status };
  const get = await fetch(url, { method: 'GET', redirect: 'follow' });
  return { ok: get.ok, method: 'GET', status: get.status };
}

function pickArchivedImageUrl(jobs) {
  const rows = Array.isArray(jobs) ? jobs : [];
  for (const job of rows) {
    const artifacts = Array.isArray(job.artifacts) ? job.artifacts : [];
    for (const artifact of artifacts) {
      const url = String(artifact?.url || '').trim();
      if (artifact?.archived && /^https?:\/\//i.test(url)) return url;
      if (url.includes('/public/ai-gateway-results/')) return url;
    }
    const media = job.mediaArchive || job.metadata?.mediaArchive;
    if (media?.status === 'ok') {
      const outUrl = String(job.output?.imageUrl || job.output?.url || '').trim();
      if (/^https?:\/\//i.test(outUrl)) return outUrl;
    }
  }
  return '';
}

async function main() {
  const optional = isSmokeOptional(process.env, 'AI_GATEWAY_R2_SMOKE_OPTIONAL');
  const identifier = String(process.env.ADMIN_IDENTIFIER || '').trim();
  const password = String(process.env.ADMIN_PASSWORD || '').trim();
  const authBase = process.env.AUTH_API_BASE || DEFAULT_AUTH;

  const health = await fetch(`${String(authBase).replace(/\/+$/, '')}/healthz`).then((r) => r.json()).catch(() => ({}));
  let r2Configured = health?.mediaArchive?.r2Configured === true;
  const proxyBase = String(process.env.AI_WORKER_PROXY_API || process.env.VITE_AI_WORKER_PROXY_API || '').replace(
    /\/+$/,
    ''
  );
  if (!r2Configured && proxyBase && /^https?:\/\//i.test(proxyBase)) {
    try {
      const proxyHealth = await fetch(`${proxyBase}/healthz`).then((r) => r.json());
      r2Configured = proxyHealth?.aiGateway?.mediaArchive?.r2Configured === true;
    } catch {
      /* ignore */
    }
  }

  if (!r2Configured) {
    console.warn('[smoke:ai-gateway-r2] SKIPPED: R2 not configured on healthz (C14 WARN path)');
    process.exit(exitCodeForStatus('blocked', { optional, reportBlocked: true }));
  }

  const early = classifyAdminPrereq({ identifier, password });
  if (early.status === 'blocked') {
    console.warn('[smoke:ai-gateway-r2] SKIPPED: missing ADMIN credentials to sample jobs');
    process.exit(exitCodeForStatus('blocked', { optional, reportBlocked: true }));
  }

  const client = new AdminClient({
    authBase,
    origin: process.env.ADMIN_ORIGIN || DEFAULT_ORIGIN,
    identifier,
    password,
  });
  await client.login();

  let jobs = [];
  try {
    const list = await client.get('/api/admin/ai-jobs?limit=30&status=succeeded');
    jobs = Array.isArray(list?.jobs) ? list.jobs : Array.isArray(list?.items) ? list.items : [];
  } catch (err) {
    console.warn('[smoke:ai-gateway-r2] could not list admin jobs:', err instanceof Error ? err.message : err);
  }

  const sampleUrl = pickArchivedImageUrl(jobs);
  const prereq = classifyR2MediaPrereq({ r2Configured: true, hasArchivedUrl: Boolean(sampleUrl) });
  if (prereq.status === 'skipped') {
    console.warn(`[smoke:ai-gateway-r2] SKIPPED: ${prereq.reason}`);
    process.exit(exitCodeForStatus('blocked', { optional, reportBlocked: true }));
  }

  console.log('[smoke:ai-gateway-r2] re-GET sample', sampleUrl.slice(0, 120));
  const probe = await headOrGetOk(sampleUrl);
  if (!probe.ok) {
    console.error('[smoke:ai-gateway-r2] FAILED: archived media not re-fetchable', probe);
    process.exit(1);
  }
  console.log('[smoke:ai-gateway-r2] OK', probe.method, probe.status);
  process.exit(0);
}

export { pickArchivedImageUrl };

const isDirect =
  process.argv[1] &&
  (process.argv[1].endsWith('check-ai-gateway-r2-media.mjs') ||
    process.argv[1].includes('check-ai-gateway-r2-media'));

if (isDirect) {
  main().catch((err) => {
    console.error('[smoke:ai-gateway-r2]', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
