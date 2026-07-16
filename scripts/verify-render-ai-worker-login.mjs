/**
 * 验证：真实登录 → 积分预扣 → Render AI Worker Proxy forward 生图（Vertex）。
 * 用法：
 *   $env:VERIFY_USER='maoer'; $env:VERIFY_PASS='***'; node scripts/verify-render-ai-worker-login.mjs
 */
const VITE = 'http://127.0.0.1:3000';
const AI_WORKER_PROXY_FORWARD_PREFIX = '/__ac-ai-worker-forward/0';
const USER = String(process.env.VERIFY_USER || 'maoer').trim();
const PASS = String(process.env.VERIFY_PASS || '').trim();
const POLL_MS = 2500;
const POLL_MAX_MS = 180_000;

function fail(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

function ok(msg) {
  console.log(`✅ ${msg}`);
}

function warn(msg) {
  console.log(`⚠️  ${msg}`);
}

function cookieHeaderFromResponse(res) {
  const lines = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  if (lines.length) {
    return lines.map((l) => l.split(';')[0].trim()).join('; ');
  }
  const single = res.headers.get('set-cookie');
  if (!single) return '';
  return single
    .split(/,(?=[^;]+?=)/)
    .map((l) => l.split(';')[0].trim())
    .join('; ');
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  if (!PASS) fail('请设置环境变量 VERIFY_PASS');

  console.log('\n=== 验证：登录 + 积分 + Render 生图 ===\n');

  const loginRes = await fetch(`${VITE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: VITE },
    body: JSON.stringify({ identifier: USER, password: PASS }),
  });
  const loginBody = await loginRes.json().catch(() => ({}));
  const cookie = cookieHeaderFromResponse(loginRes);
  if (!loginRes.ok || !cookie.includes('ac_session=')) {
    fail(`登录失败 HTTP ${loginRes.status} ${JSON.stringify(loginBody)}`);
  }
  ok(`登录成功：${loginBody?.user?.username || loginBody?.username || USER}`);

  const meRes = await fetch(`${VITE}/api/auth/me`, { headers: { Cookie: cookie, Origin: VITE } });
  const me = await meRes.json().catch(() => ({}));
  const userId = me?.user?.id || me?.id;
  if (!meRes.ok || !userId) fail(`auth/me 失败 HTTP ${meRes.status}`);
  ok(`用户 id=${userId}`);

  const balRes = await fetch(`${VITE}/api/credits/balance`, { headers: { Cookie: cookie, Origin: VITE } });
  const bal = await balRes.json().catch(() => ({}));
  if (balRes.ok) ok(`积分余额：${bal?.balance ?? bal?.available ?? JSON.stringify(bal)}`);

  const bundleRes = await fetch(`${VITE}/api/auth/credits-proxy-bundle?estimatedCredits=134`, {
    headers: { Cookie: cookie, Origin: VITE },
  });
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
  if (!headers['X-AC-Fairness-Key']) headers['X-AC-Fairness-Key'] = `user:${userId}`;

  const createUrl = `${VITE}${AI_WORKER_PROXY_FORWARD_PREFIX}/proxy/gemini/async`;
  const createRes = await fetch(createUrl, {
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
  console.log(`\nasync 创建 HTTP ${createRes.status}`);
  if (!createRes.ok) {
    if (/fetch failed/i.test(createText)) {
      warn('Render 返回 fetch failed：多为云端 ai-worker-proxy ↔ auth-api 积分校验或出站网络问题');
    }
    fail(`async 创建失败 ${createText.slice(0, 500)}`);
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
    const pollRes = await fetch(`${VITE}${AI_WORKER_PROXY_FORWARD_PREFIX}/proxy/gemini/async/${encodeURIComponent(jobId)}`, {
      headers: { Cookie: cookie, Origin: VITE, ...(bundle.headers || {}) },
      credentials: 'include',
    });
    const pollText = await pollRes.text();
    if (!pollRes.ok) fail(`轮询失败 HTTP ${pollRes.status} ${pollText.slice(0, 300)}`);
    let poll;
    try {
      poll = JSON.parse(pollText);
    } catch {
      fail(`轮询非 JSON：${pollText.slice(0, 200)}`);
    }
    const status = String(poll.status || '').toLowerCase();
    process.stdout.write(`\r   轮询 status=${status} …`);
    if (status === 'completed' || status === 'succeeded' || status === 'done') {
      console.log('');
      ok('生图完成');
      console.log(pollText.slice(0, 320));
      console.log('\n=== 验证通过 ===\n');
      return;
    }
    if (status === 'failed' || status === 'error') {
      console.log('');
      fail(`任务失败：${poll.error || pollText.slice(0, 500)}`);
    }
  }
  console.log('');
  fail(`轮询超时（>${POLL_MAX_MS / 1000}s）`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
