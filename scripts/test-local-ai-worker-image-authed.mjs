/**
 * 本地同源生图 E2E（与线上一致：Vertex + 积分闸门）。
 * session → credits-proxy-bundle → POST async（aiBackend: vertex）→ 轮询至完成。
 *
 * 用法：node --env-file=.env.local scripts/test-local-ai-worker-image-authed.mjs
 *
 * 本机 ai-worker-proxy 须已配置 VERTEX_PROJECT_ID + ADC（见 docs/VERTEX_AI_INTEGRATION.md）。
 * 设 E2E_AI_BACKEND=gemini 可改测 AI Studio Key 路径（非默认）。
 */
import crypto from 'crypto';
import { createSession } from '../server/auth-store.js';

const VITE = 'http://127.0.0.1:3000';
const LOCAL_PROXY = 'http://127.0.0.1:9002';
const USER_ID = 'd93ce5f5-38f9-4b66-8f40-b64028b53fae';

const POLL_MS = 2000;
const POLL_MAX_MS = 180_000;
const USE_VERTEX = String(process.env.E2E_AI_BACKEND || 'vertex').trim().toLowerCase() !== 'gemini';

function fail(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

function ok(msg) {
  console.log(`✅ ${msg}`);
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function assertUpstreamReady() {
  const res = await fetch(`${LOCAL_PROXY}/healthz`, { cache: 'no-store' });
  const text = await res.text();
  if (!res.ok) fail(`ai-worker-proxy healthz 失败 HTTP ${res.status}`);
  let health;
  try {
    health = JSON.parse(text);
  } catch {
    fail(`ai-worker-proxy healthz 非 JSON：${text.slice(0, 200)}`);
  }

  if (USE_VERTEX) {
    const vtx = health?.vertex || {};
    if (!vtx.configured) {
      fail(
        '本机 ai-worker-proxy 未配置 Vertex（healthz vertex.configured=false）。请在 .env.local 设置 VERTEX_PROJECT_ID（或 GOOGLE_CLOUD_PROJECT）与 GOOGLE_APPLICATION_CREDENTIALS（或 GOOGLE_APPLICATION_CREDENTIALS_JSON），重启 9002。见 docs/VERTEX_AI_INTEGRATION.md'
      );
    }
    if (!vtx.adcLikelyConfigured) {
      fail(
        'Vertex ADC 未就绪（healthz vertex.adcLikelyConfigured=false）。请配置服务账号 JSON 或 gcloud application-default login 后重启 ai-worker-proxy'
      );
    }
    ok(`Vertex 就绪 project=${vtx.project || '(healthz)'} location=${vtx.location || 'global'}`);
    return;
  }

  const key = String(process.env.GEMINI_API_KEY || '').trim();
  if (!key) fail('E2E_AI_BACKEND=gemini 时须在 .env.local 配置 GEMINI_API_KEY');
  ok('AI Studio 路径（E2E_AI_BACKEND=gemini）');
}

async function main() {
  console.log(`\n=== 本地同源生图 E2E（${USE_VERTEX ? 'Vertex' : 'AI Studio'}）===\n`);

  await assertUpstreamReady();

  const token = crypto.randomBytes(32).toString('hex');
  await createSession({
    userId: USER_ID,
    token,
    maxAgeMs: 3600_000,
    userAgent: 'local-e2e-test',
    ip: '127.0.0.1',
  });
  const cookie = `ac_session=${token}`;

  const meRes = await fetch(`${VITE}/api/auth/me`, { headers: { Cookie: cookie } });
  const me = await meRes.json().catch(() => ({}));
  if (!meRes.ok) fail(`auth/me 失败 HTTP ${meRes.status}`);
  ok(`登录 session：${me?.user?.username || me?.username || USER_ID}`);

  const bundleRes = await fetch(
    `${VITE}/api/auth/credits-proxy-bundle?estimatedCredits=134`,
    { headers: { Cookie: cookie } }
  );
  const bundle = await bundleRes.json().catch(() => ({}));
  if (!bundleRes.ok || bundle.disabled) {
    fail(`credits-proxy-bundle 失败 HTTP ${bundleRes.status} ${JSON.stringify(bundle)}`);
  }
  if (!bundle.reserveKey?.trim()) fail('credits-proxy-bundle 未返回 reserveKey');
  ok(`积分预扣 reserveKey=${String(bundle.reserveKey).slice(0, 28)}…`);

  const headers = {
    'Content-Type': 'application/json',
    Cookie: cookie,
    Origin: VITE,
    ...(bundle.headers || {}),
  };
  if (!headers['X-AC-Credits-Reserve']) headers['X-AC-Credits-Reserve'] = bundle.reserveKey;
  if (!headers['X-AC-Fairness-Key']) headers['X-AC-Fairness-Key'] = `user:${USER_ID}`;

  const createUrl = `${VITE}/proxy/gemini/async`;
  const body = JSON.stringify({
    model: 'gemini-2.5-flash-image',
    contents: [{ role: 'user', parts: [{ text: 'A single small red circle on pure white background, minimal.' }] }],
    estimatedCredits: 134,
    ...(USE_VERTEX ? { aiBackend: 'vertex' } : {}),
  });

  const createRes = await fetch(createUrl, { method: 'POST', headers, body, credentials: 'include' });
  const createText = await createRes.text();
  if (!createRes.ok) {
    fail(`async 创建失败 HTTP ${createRes.status} ${createText.slice(0, 400)}`);
  }
  let jobId = '';
  try {
    jobId = JSON.parse(createText).jobId || '';
  } catch {
    fail(`async 响应非 JSON：${createText.slice(0, 200)}`);
  }
  if (!jobId) fail('async 未返回 jobId');
  ok(`async 任务已创建 jobId=${jobId}`);

  const deadline = Date.now() + POLL_MAX_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const pollRes = await fetch(`${VITE}/proxy/gemini/async/${encodeURIComponent(jobId)}`, {
      headers: { Cookie: cookie, Origin: VITE, ...(bundle.headers || {}) },
      credentials: 'include',
    });
    const pollText = await pollRes.text();
    if (!pollRes.ok) {
      fail(`轮询失败 HTTP ${pollRes.status} ${pollText.slice(0, 300)}`);
    }
    let poll;
    try {
      poll = JSON.parse(pollText);
    } catch {
      fail(`轮询响应非 JSON：${pollText.slice(0, 200)}`);
    }
    const status = String(poll.status || '').toLowerCase();
    process.stdout.write(`\r   轮询 status=${status || '?'} …`);
    if (status === 'completed' || status === 'succeeded' || status === 'done') {
      console.log('');
      const hasImage =
        Boolean(poll.result?.candidates?.length) ||
        Boolean(poll.result?.text) ||
        JSON.stringify(poll).includes('inlineData');
      if (hasImage) {
        ok('生图完成（响应含 candidates/text）');
        console.log(JSON.stringify({ jobId, status, snippet: pollText.slice(0, 240) }, null, 2));
        console.log('\n=== 本地 E2E 通过 ===\n');
        return;
      }
      ok(`任务 completed：${pollText.slice(0, 200)}`);
      console.log('\n=== 本地 E2E 通过（completed）===\n');
      return;
    }
    if (status === 'failed' || status === 'error') {
      console.log('');
      fail(`任务失败：${poll.error || pollText.slice(0, 400)}`);
    }
  }
  console.log('');
  fail(`轮询超时（>${POLL_MAX_MS / 1000}s）`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
