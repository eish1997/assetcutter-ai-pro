/**
 * 模拟浏览器：localhost Vite 同源 /api → 云端 auth 中继 → Render 生图（Vertex）。
 * 用法：$env:VERIFY_USER='maoer'; $env:VERIFY_PASS='***'; node scripts/verify-local-vite-relay.mjs
 */
const VITE = 'http://127.0.0.1:3000';
const USER = String(process.env.VERIFY_USER || 'maoer').trim();
const PASS = String(process.env.VERIFY_PASS || '').trim();
const POLL_MS = 2500;
const POLL_MAX_MS = 200_000;

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

  console.log('\n=== 本地 Vite 同源中继生图 E2E ===\n');

  try {
    const ping = await fetch(VITE, { cache: 'no-store' });
    if (!ping.ok) fail(`Vite 未就绪 HTTP ${ping.status}，请先 npm run dev`);
  } catch (e) {
    fail(`无法连接 ${VITE}：${e instanceof Error ? e.message : e}（请先 npm run dev）`);
  }
  ok('Vite dev 可达');

  const loginRes = await fetch(`${VITE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: VITE },
    body: JSON.stringify({ identifier: USER, password: PASS }),
    credentials: 'include',
  });
  const loginBody = await loginRes.json().catch(() => ({}));
  const cookie = cookies(loginRes);
  if (!loginRes.ok || !cookie.includes('ac_session=')) {
    fail(`登录失败 HTTP ${loginRes.status} ${JSON.stringify(loginBody)}`);
  }
  ok(`登录成功：${loginBody?.user?.username || USER}`);

  const meRes = await fetch(`${VITE}/api/auth/me`, { headers: { Cookie: cookie, Origin: VITE } });
  const me = await meRes.json().catch(() => ({}));
  const userId = me?.user?.id || me?.id;
  if (!meRes.ok || !userId) fail(`auth/me 失败 HTTP ${meRes.status}`);

  const bundleRes = await fetch(`${VITE}/api/auth/credits-proxy-bundle?estimatedCredits=134`, {
    headers: { Cookie: cookie, Origin: VITE },
  });
  const bundle = await bundleRes.json().catch(() => ({}));
  if (!bundleRes.ok || !bundle.reserveKey) {
    fail(`credits-proxy-bundle 失败 HTTP ${bundleRes.status} ${JSON.stringify(bundle)}`);
  }
  ok(`积分预扣 reserveKey=${String(bundle.reserveKey).slice(0, 28)}…`);

  const headers = {
    'Content-Type': 'application/json',
    Cookie: cookie,
    Origin: VITE,
    ...(bundle.headers || {}),
    'X-AC-Credits-Reserve': bundle.reserveKey,
    'X-AC-Fairness-Key': `user:${userId}`,
  };

  const createRes = await fetch(`${VITE}/api/ai-worker-proxy/proxy/gemini/async`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'gemini-2.5-flash-image',
      contents: [{ role: 'user', parts: [{ text: 'A single small red circle on pure white background, minimal.' }] }],
      estimatedCredits: 134,
      aiBackend: 'vertex',
    }),
    credentials: 'include',
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
    const pollRes = await fetch(`${VITE}/api/ai-worker-proxy/proxy/gemini/async/${encodeURIComponent(jobId)}`, {
      headers: { Cookie: cookie, Origin: VITE, ...(bundle.headers || {}) },
      credentials: 'include',
    });
    const pollText = await pollRes.text();
    if (!pollRes.ok) fail(`轮询失败 HTTP ${pollRes.status} ${pollText.slice(0, 300)}`);
    const poll = JSON.parse(pollText);
    process.stdout.write(`\r   轮询 status=${poll.status} …`);
    if (poll.status === 'completed') {
      console.log('');
      const hasImage =
        Boolean(poll.result?.candidates?.length) ||
        JSON.stringify(poll).includes('inlineData');
      if (!hasImage) fail(`completed 但无图像数据：${pollText.slice(0, 400)}`);
      ok('生图完成（含 inlineData/candidates）');
      console.log('\n=== E2E 通过 ===\n');
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
