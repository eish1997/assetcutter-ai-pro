#!/usr/bin/env node
/**
 * R5.3: Local HTTP image smoke via POST /api/ai/jobs (auth + credits path).
 *
 *   AUTH_API_BASE=http://127.0.0.1:9100 SMOKE_USER=... SMOKE_PASS=... npm run smoke:ai-gateway-local-http-image
 *   AI_GATEWAY_SMOKE_OPTIONAL=1  → exit 0 when credentials missing or auth-api unreachable
 *
 * Optional:
 *   ADMIN_ORIGIN / SMOKE_ORIGIN (default http://127.0.0.1:5173)
 *   AI_GATEWAY_LOCAL_IMAGE_PROVIDER (default 302ai)
 *   AI_GATEWAY_LOCAL_IMAGE_MODEL (default gpt-image-1.5)
 *   AI_GATEWAY_HTTP_SMOKE_POLL_MS / AI_GATEWAY_HTTP_SMOKE_TIMEOUT_MS
 */
import { fetch } from 'undici';

const DEFAULT_AUTH = 'http://127.0.0.1:9100';
const DEFAULT_ORIGIN = 'http://127.0.0.1:5173';

function optionalSkip() {
  return (
    String(process.env.AI_GATEWAY_SMOKE_OPTIONAL || '').trim() === '1' ||
    String(process.env.AI_GATEWAY_LOCAL_HTTP_IMAGE_SMOKE_OPTIONAL || '').trim() === '1'
  );
}

function cookieHeaderFromResponse(res) {
  const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  return raw
    .map((value) => String(value).split(';')[0])
    .filter(Boolean)
    .join('; ');
}

function publicError(res, text) {
  try {
    const parsed = JSON.parse(text || '{}');
    return parsed.message || parsed.error || parsed.code || text;
  } catch {
    return text || `HTTP ${res.status}`;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const authBase = String(process.env.AUTH_API_BASE || DEFAULT_AUTH).replace(/\/+$/, '');
  const origin = String(process.env.ADMIN_ORIGIN || process.env.SMOKE_ORIGIN || DEFAULT_ORIGIN).trim();
  const identifier = String(
    process.env.SMOKE_USER || process.env.VERIFY_USER || process.env.ADMIN_IDENTIFIER || ''
  ).trim();
  const password = String(
    process.env.SMOKE_PASS || process.env.VERIFY_PASS || process.env.ADMIN_PASSWORD || ''
  ).trim();
  const providerId = String(process.env.AI_GATEWAY_LOCAL_IMAGE_PROVIDER || '302ai').trim().toLowerCase();
  const model = String(process.env.AI_GATEWAY_LOCAL_IMAGE_MODEL || 'gpt-image-1.5').trim();
  const pollMs = Math.max(500, Number(process.env.AI_GATEWAY_HTTP_SMOKE_POLL_MS) || 2000);
  const timeoutMs = Math.max(10_000, Number(process.env.AI_GATEWAY_HTTP_SMOKE_TIMEOUT_MS) || 600_000);

  if (!identifier || !password) {
    console.error('[smoke:ai-gateway-local-http-image] BLOCKED: set SMOKE_USER + SMOKE_PASS (or VERIFY_* / ADMIN_*)');
    process.exit(optionalSkip() ? 0 : 2);
  }

  let loginRes;
  try {
    loginRes = await fetch(`${authBase}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ identifier, password }),
    });
  } catch (err) {
    console.error(
      `[smoke:ai-gateway-local-http-image] BLOCKED: cannot reach ${authBase} (${err instanceof Error ? err.message : err})`
    );
    process.exit(optionalSkip() ? 0 : 2);
  }

  const loginText = await loginRes.text();
  const cookie = cookieHeaderFromResponse(loginRes);
  if (!loginRes.ok || !cookie.includes('ac_session=')) {
    console.error(
      `[smoke:ai-gateway-local-http-image] BLOCKED: login failed HTTP ${loginRes.status} ${publicError(loginRes, loginText)}`
    );
    process.exit(optionalSkip() ? 0 : 2);
  }

  const headers = {
    'Content-Type': 'application/json',
    Origin: origin,
    Cookie: cookie,
  };

  const started = Date.now();
  const createRes = await fetch(`${authBase}/api/ai/jobs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      id: `aijob_http_img_smoke_${Date.now()}`,
      modality: 'image',
      model,
      provider: providerId,
      estimatedCredits: 1,
      input: {
        contents: [
          {
            role: 'user',
            parts: [{ text: 'a simple green cube on white background, studio product photo, no text' }],
          },
        ],
        config: { imageConfig: { size: '1024x1024' } },
      },
    }),
  });
  const createText = await createRes.text();
  let createBody = {};
  try {
    createBody = JSON.parse(createText || '{}');
  } catch {
    createBody = { raw: createText };
  }
  if (!createRes.ok) {
    console.error(
      JSON.stringify({
        phase: 'create_failed',
        status: createRes.status,
        error: publicError(createRes, createText),
        body: createBody,
      })
    );
    process.exit(1);
  }

  const job =
    createBody.job && typeof createBody.job === 'object'
      ? createBody.job
      : createBody.result?.job && typeof createBody.result.job === 'object'
        ? createBody.result.job
        : createBody;
  const jobId = String(job?.id || createBody.id || '').trim();
  if (!jobId) {
    console.error('[smoke:ai-gateway-local-http-image] create ok but missing job id', createBody);
    process.exit(1);
  }

  console.log(
    JSON.stringify({
      phase: 'created',
      jobId,
      status: job?.status || null,
      providerId: job?.route?.providerId || createBody.route?.providerId || providerId,
      model,
    })
  );

  let finalJob = job;
  while (Date.now() - started < timeoutMs) {
    const status = String(finalJob?.status || '').toLowerCase();
    if (status === 'succeeded' || status === 'failed' || status === 'cancelled') break;
    await sleep(pollMs);
    const pollRes = await fetch(`${authBase}/api/ai/jobs/${encodeURIComponent(jobId)}`, {
      method: 'GET',
      headers: { Origin: origin, Cookie: cookie },
    });
    const pollText = await pollRes.text();
    let pollBody = {};
    try {
      pollBody = JSON.parse(pollText || '{}');
    } catch {
      pollBody = { raw: pollText };
    }
    if (!pollRes.ok) {
      console.error(
        JSON.stringify({
          phase: 'poll_failed',
          status: pollRes.status,
          error: publicError(pollRes, pollText),
        })
      );
      process.exit(1);
    }
    finalJob =
      pollBody.job && typeof pollBody.job === 'object'
        ? pollBody.job
        : pollBody.result?.job && typeof pollBody.result.job === 'object'
          ? pollBody.result.job
          : pollBody;
  }

  const arts = Array.isArray(finalJob?.artifacts) ? finalJob.artifacts : [];
  const summary = {
    phase: 'done',
    jobId,
    status: finalJob?.status || null,
    artifactCount: arts.length,
    elapsedMs: Date.now() - started,
    error: finalJob?.error || finalJob?.gatewayFailure || null,
  };
  console.log(JSON.stringify(summary));
  if (String(finalJob?.status || '').toLowerCase() !== 'succeeded' || arts.length < 1) {
    process.exit(1);
  }
  console.log('[smoke:ai-gateway-local-http-image] OK');
}

main().catch((err) => {
  console.error('[smoke:ai-gateway-local-http-image]', err instanceof Error ? err.message : err);
  process.exit(1);
});
