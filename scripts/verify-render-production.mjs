/**
 * 云端 auth + 直连 Render gemini-proxy 生图 E2E（Vertex）。
 * 用法：$env:VERIFY_USER='maoer'; $env:VERIFY_PASS='***'; node --env-file=.env.local scripts/verify-render-production.mjs
 */
import { ProxyAgent, fetch as undiciFetch } from 'undici';

const AUTH = 'https://assetcutter-auth-api.onrender.com';
const PROXY = 'https://assetcutter-gemini-proxy.onrender.com';
const USER = String(process.env.VERIFY_USER || 'maoer').trim();
const PASS = String(process.env.VERIFY_PASS || '').trim();
const POLL_MS = 2500;
const POLL_MAX_MS = 200_000;

const proxy = String(process.env.HTTPS_PROXY || process.env.TRIPO_PROXY || '').trim();
const dispatcher = proxy ? new ProxyAgent(proxy) : undefined;
const fetchOpts = dispatcher ? { dispatcher } : {};

function fail(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

function ok(msg) {
  console.log(`✅ ${msg}`);
}

function cookies(res) {
  const lines = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  return lines.map((l) => l.split(';')[0].trim()).join('; ');
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  if (!PASS) fail('请设置 VERIFY_PASS');

  console.log('\n=== 云端 auth + Render 直连生图 ===\n');

  const loginRes = await undiciFetch(`${AUTH}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://app.adrazzo.com' },
    body: JSON.stringify({ identifier: USER, password: PASS }),
    ...fetchOpts,
  });
  const loginBody = await loginRes.json().catch(() => ({}));
  const cookie = cookies(loginRes);
  if (!loginRes.ok || !cookie.includes('ac_session=')) {
    fail(`登录失败 HTTP ${loginRes.status} ${JSON.stringify(loginBody)}`);
  }
  ok(`登录成功：${loginBody?.user?.username || USER}`);

  const gateRes = await undiciFetch(`${AUTH}/api/auth/credits-gate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ estimatedCredits: 134 }),
    ...fetchOpts,
  });
  const gateText = await gateRes.text();
  console.log(`credits-gate（无 Origin）HTTP ${gateRes.status} ${gateText.slice(0, 120)}`);
  if (gateRes.status === 403) {
    fail('云端 auth-api 仍未放行 server-to-server credits-gate，请确认 Render auth-api 已用最新 master 部署');
  }

  const bundleRes = await undiciFetch(`${AUTH}/api/auth/credits-proxy-bundle?estimatedCredits=134`, {
    headers: { Cookie: cookie, Origin: 'https://app.adrazzo.com' },
    ...fetchOpts,
  });
  const bundle = await bundleRes.json().catch(() => ({}));
  if (!bundleRes.ok || !bundle.reserveKey) {
    fail(`credits-proxy-bundle 失败 HTTP ${bundleRes.status} ${JSON.stringify(bundle)}`);
  }
  ok(`积分预扣 reserveKey=${String(bundle.reserveKey).slice(0, 28)}…`);

  const headers = {
    'Content-Type': 'application/json',
    Cookie: cookie,
    Origin: 'https://app.adrazzo.com',
    ...(bundle.headers || {}),
    'X-AC-Credits-Reserve': bundle.reserveKey,
    'X-AC-Fairness-Key': `user:${loginBody.user.id}`,
  };

  const createRes = await undiciFetch(`${PROXY}/proxy/gemini/async`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'gemini-2.5-flash-image',
      contents: [{ role: 'user', parts: [{ text: 'A single small red circle on white background.' }] }],
      estimatedCredits: 134,
      aiBackend: 'vertex',
    }),
    ...fetchOpts,
  });
  const createText = await createRes.text();
  console.log(`async 创建 HTTP ${createRes.status}`);
  if (!createRes.ok) fail(`async 创建失败 ${createText.slice(0, 500)}`);

  const jobId = JSON.parse(createText).jobId;
  if (!jobId) fail('未返回 jobId');
  ok(`jobId=${jobId}`);

  const deadline = Date.now() + POLL_MAX_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const pollRes = await undiciFetch(`${PROXY}/proxy/gemini/async/${encodeURIComponent(jobId)}`, {
      headers: { Cookie: cookie, Origin: 'https://app.adrazzo.com', ...(bundle.headers || {}) },
      ...fetchOpts,
    });
    const pollText = await pollRes.text();
    const poll = JSON.parse(pollText);
    process.stdout.write(`\r   轮询 status=${poll.status} …`);
    if (poll.status === 'completed') {
      console.log('');
      ok('生图完成');
      console.log(pollText.slice(0, 320));
      console.log('\n=== 云端验证通过 ===\n');
      return;
    }
    if (poll.status === 'failed') {
      console.log('');
      fail(poll.error || pollText.slice(0, 500));
    }
  }
  fail('轮询超时');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
